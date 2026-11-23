import { AppError } from "./app-error";

/**
 * 업로드한 영상·음성 파일을 대본(자막)으로 바꿉니다.
 *
 * 경로:
 *  1) OPENAI_API_KEY → whisper-1 (mp4/mov/webm/mp3/m4a/wav 직접 업로드 가능, 25MB까지)
 *  2) GEMINI_API_KEY → Gemini 음성 전사(작은 파일은 inlineData)
 * 둘 다 없으면 기능을 끄고 캡션·대본 붙여넣기로 안내합니다.
 */
export type SttProviderId = "openai" | "gemini";

export interface SttStatus {
  configured: boolean;
  provider: SttProviderId | null;
  model: string | null;
  reason: string | null;
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  provider: SttProviderId;
  model: string;
  seconds: number | null;
}

const OPENAI_BASE = "https://api.openai.com/v1";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";
/** Gemini inlineData 요청은 20MB가 상한입니다(전체 요청 기준). */
const GEMINI_INLINE_LIMIT = 18 * 1024 * 1024;

export function sttStatus(env: Record<string, string | undefined> = process.env): SttStatus {
  const openai = env.OPENAI_API_KEY?.trim();
  if (openai) {
    return {
      configured: true,
      provider: "openai",
      model: env.OPENAI_STT_MODEL?.trim() || "whisper-1",
      reason: null,
    };
  }
  const gemini = env.GEMINI_API_KEY?.trim();
  if (gemini) {
    return {
      configured: true,
      provider: "gemini",
      model: env.GEMINI_STT_MODEL?.trim() || DEFAULT_GEMINI_TRANSCRIBE_MODEL,
      reason: null,
    };
  }
  return {
    configured: false,
    provider: null,
    model: null,
    reason: "OPENAI_API_KEY·GEMINI_API_KEY가 없어 영상 파일 전사를 쓸 수 없습니다. 캡션·대본을 붙여넣어 주세요.",
  };
}

export async function transcribeMedia(
  input: { bytes: Buffer; filename: string; mimeType: string; language: "ko" | "en" },
  options: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {},
): Promise<TranscriptionResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const status = sttStatus(env);

  if (!status.configured || !status.provider) {
    throw new AppError("stt_unavailable", status.reason ?? "전사 기능이 꺼져 있습니다.", 503, {
      nextActions: ["paste"],
    });
  }

  if (status.provider === "openai") {
    return transcribeWithOpenAI(input, {
      apiKey: env.OPENAI_API_KEY!.trim(),
      model: status.model ?? "whisper-1",
      fetchImpl,
      language: input.language,
    });
  }

  return transcribeWithGemini(input, {
    apiKey: env.GEMINI_API_KEY!.trim(),
    model: status.model ?? DEFAULT_GEMINI_TRANSCRIBE_MODEL,
    fetchImpl,
    language: input.language,
  });
}

async function transcribeWithOpenAI(
  input: { bytes: Buffer; filename: string; mimeType: string },
  options: { apiKey: string; model: string; fetchImpl: typeof fetch; language: "ko" | "en" },
): Promise<TranscriptionResult> {
  if (input.bytes.byteLength > 25 * 1024 * 1024) {
    throw new AppError(
      "file_too_large",
      "파일이 25MB를 넘습니다. 1~3분 분량으로 자르거나 음성만 추출해 올려 주세요.",
      413,
      { nextActions: ["paste"] },
    );
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.filename);
  form.append("model", options.model);
  form.append("response_format", "verbose_json");
  form.append("language", options.language);

  let response: Response;
  try {
    response = await options.fetchImpl(`${OPENAI_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new AppError(
      "stt_unavailable",
      `전사 요청이 응답하지 않습니다: ${error instanceof Error ? error.message : String(error)}`,
      502,
      { nextActions: ["retry", "paste"] },
    );
  }

  const raw = await response.text();
  if (!response.ok) {
    const message = (() => {
      try {
        return (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? raw;
      } catch {
        return raw;
      }
    })();
    if (response.status === 401) {
      throw new AppError("stt_unavailable", "OpenAI 키가 유효하지 않습니다. 서버 설정을 확인해 주세요.", 502, {
        nextActions: ["paste"],
      });
    }
    if (response.status === 429) {
      throw new AppError("ai_failed", "전사 사용량이 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.", 429, {
        reason: "ai_quota",
        nextActions: ["retry", "paste"],
      });
    }
    throw new AppError("stt_unavailable", `전사에 실패했습니다: ${message.slice(0, 200)}`, 502, {
      nextActions: ["retry", "paste"],
    });
  }

  let parsed: { text?: string; language?: string; duration?: number };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new AppError("stt_unavailable", "전사 응답을 읽지 못했습니다.", 502, { nextActions: ["retry", "paste"] });
  }

  const text = cleanTranscript(parsed.text ?? "");
  if (!text) {
    throw new AppError(
      "stt_unavailable",
      "영상에서 말소리를 찾지 못했습니다(무음 영상이거나 음성이 매우 작음). 캡션·대본을 붙여넣어 주세요.",
      422,
      { reason: "no_speech", nextActions: ["paste"] },
    );
  }

  return {
    text,
    language: parsed.language ?? null,
    provider: "openai",
    model: options.model,
    seconds: parsed.duration ?? null,
  };
}

async function transcribeWithGemini(
  input: { bytes: Buffer; filename: string; mimeType: string },
  options: { apiKey: string; model: string; fetchImpl: typeof fetch; language: "ko" | "en" },
): Promise<TranscriptionResult> {
  if (input.bytes.byteLength > GEMINI_INLINE_LIMIT) {
    throw new AppError(
      "file_too_large",
      "지금 설정에서는 18MB 이하 파일만 전사할 수 있습니다. 더 짧게 자르거나 캡션·대본을 붙여넣어 주세요.",
      413,
      { nextActions: ["paste"] },
    );
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: input.mimeType, data: input.bytes.toString("base64") } },
          {
            text:
              `Transcribe the speech in this media verbatim in ${options.language === "ko" ? "Korean" : "English"}. ` +
              "Return only the spoken words as plain text, without commentary, timestamps, or quotation marks.",
          },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  };

  let response: Response;
  try {
    response = await options.fetchImpl(
      `${GEMINI_BASE}/models/${encodeURIComponent(options.model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": options.apiKey, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch (error) {
    throw new AppError(
      "stt_unavailable",
      `전사 요청이 응답하지 않습니다: ${error instanceof Error ? error.message : String(error)}`,
      502,
      { nextActions: ["retry", "paste"] },
    );
  }

  const raw = await response.text();
  if (!response.ok) {
    if (response.status === 429) {
      throw new AppError("ai_failed", "전사 사용량이 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.", 429, {
        reason: "ai_quota",
        nextActions: ["retry", "paste"],
      });
    }
    throw new AppError("stt_unavailable", `전사에 실패했습니다(HTTP ${response.status}).`, 502, {
      nextActions: ["retry", "paste"],
    });
  }

  let parsed: {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new AppError("stt_unavailable", "전사 응답을 읽지 못했습니다.", 502, { nextActions: ["retry", "paste"] });
  }

  const text = cleanTranscript(
    (parsed.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join(" ").trim(),
  );
  if (!text) {
    throw new AppError(
      "stt_unavailable",
      "영상에서 말소리를 찾지 못했습니다. 캡션·대본을 붙여넣어 주세요.",
      422,
      { reason: "no_speech", nextActions: ["paste"] },
    );
  }

  return { text, language: options.language, provider: "gemini", model: options.model, seconds: null };
}

/** 전사문 정리: 줄 끝·앞 공백과 빈 줄 과다를 정리합니다. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
