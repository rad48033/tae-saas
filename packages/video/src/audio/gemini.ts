import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { wavDurationMs, readWavInfo } from "./wav";
import type { GeneratedAudio, TtsProvider, TtsRequest, VideoLanguage } from "../types";

export const DEFAULT_GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini TTS 어댑터.
 *
 * `generateContent`에 `responseModalities: ["AUDIO"]`를 주면 24kHz mono 16-bit WAV가
 * `inlineData`로 돌아옵니다(길이를 헤더에서 직접 계산). OpenAI TTS와 같은 계약을 따르므로
 * `OPENAI_API_KEY`가 없을 때 실제 AI 음성 경로로 씁니다.
 */

/** OpenAI 보이스 이름을 Gemini 프리셋 보이스로 옮깁니다. */
const VOICE_MAP: Record<string, string> = {
  alloy: "Kore",
  echo: "Charon",
  fable: "Aoede",
  onyx: "Fenrir",
  nova: "Leda",
  shimmer: "Zephyr",
  sage: "Kore",
  coral: "Leda",
  verse: "Zephyr",
  ballad: "Aoede",
};

export const GEMINI_VOICES = [
  "Kore",
  "Puck",
  "Charon",
  "Fenrir",
  "Aoede",
  "Leda",
  "Orus",
  "Zephyr",
  "Enceladus",
] as const;

export function geminiVoiceFor(voice: string | undefined, language: VideoLanguage = "ko"): string {
  const requested = voice?.trim();
  if (!requested) return language === "ko" ? "Kore" : "Puck";
  const mapped = VOICE_MAP[requested.toLowerCase()];
  if (mapped) return mapped;
  const exact = GEMINI_VOICES.find((name) => name.toLowerCase() === requested.toLowerCase());
  return exact ?? (language === "ko" ? "Kore" : "Puck");
}

export interface GeminiTtsOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** 프리셋 보이스 이름을 직접 지정 (OPENAI_TTS_VOICE 대신 GEMINI_TTS_VOICE) */
  voice?: string;
  timeoutMs?: number;
  /**
   * 요청 사이 최소 간격(ms). 무료 등급은 분당 요청 수가 낮아(예: 3/min)
   * 장면이 많으면 429가 납니다. 21초 간격이면 분당 3건 안에서 유지됩니다.
   */
  minIntervalMs?: number;
}

interface GeminiAudioResponse {
  candidates?: {
    content?: { parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[] };
    finishReason?: string | null;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

const LANGUAGE_LABEL: Record<VideoLanguage, string> = {
  ko: "Korean",
  en: "English",
};

export class GeminiTtsProvider implements TtsProvider {
  readonly id = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly voice: string | null;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: GeminiTtsOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || DEFAULT_GEMINI_TTS_MODEL;
    this.baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.voice = options.voice?.trim() || null;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.minIntervalMs = options.minIntervalMs ?? 0;
  }

  async synthesize(request: TtsRequest): Promise<GeneratedAudio> {
    const text = request.text.replace(/\s+/g, " ").trim();
    if (!text) throw new Error("나레이션이 비어 있어 음성을 만들 수 없습니다.");

    const voiceName = geminiVoiceFor(this.voice ?? request.voice, request.language);
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              // 모델에게 지시문을 읽히지 않도록 언어·억양 지시는 별도 문단으로 두고 본문만 읽게 합니다.
              text: `Read the following text aloud in ${LANGUAGE_LABEL[request.language]} with a warm, natural pace. Do not read this instruction.\n\n${text}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    };

    const payload = await this.request<GeminiAudioResponse>(body);
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.find((part) => part.inlineData?.data)?.inlineData;
    if (!inline?.data) {
      const block = payload.promptFeedback?.blockReason;
      throw new Error(`Gemini TTS가 오디오를 반환하지 않았습니다${block ? ` (차단: ${block})` : ""}`);
    }

    const bytes = Buffer.from(inline.data, "base64");
    if (bytes.length === 0) throw new Error("Gemini TTS가 빈 오디오를 반환했습니다.");

    const info = readWavInfo(bytes);
    // WAV가 아니면(L16 PCM 등) 그대로 두고 ffmpeg가 읽게 합니다.
    await mkdir(path.dirname(request.outPath), { recursive: true });
    await writeFile(request.outPath, bytes);

    const durationMs = wavDurationMs(bytes) ?? request.targetDurationMs;

    return {
      sceneIndex: request.sceneIndex,
      path: request.outPath,
      durationMs,
      format: "wav",
      provider: "gemini",
      model: this.model,
      ...(info?.sampleRate ? { sampleRate: info.sampleRate } : {}),
    };
  }

  private async request<T extends GeminiAudioResponse>(body: unknown): Promise<T> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        // 장면을 동시에 만들 때도 요청은 한 줄로 세워 분당 한도 안에서 보냅니다.
        const { ok, status, raw, parsed } = await this.paced(() => this.send<T>(url, body));

        if (!ok) {
          const message = parsed?.error?.message ?? raw.slice(0, 300);
          if ((status === 429 || status >= 500) && attempt < 3) {
            // 무료 등급은 분당 요청 수가 낮습니다(예: 3/min). 서버가 알려준 대기 시간을 지킵니다.
            await sleep(retryDelayMs(message, status, attempt));
            lastError = new Error(`Gemini TTS ${status}: ${message}`);
            continue;
          }
          throw new Error(`Gemini TTS ${status}: ${message}`);
        }
        if (!parsed) throw new Error("Gemini TTS 응답을 JSON으로 읽지 못했습니다.");
        return parsed;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("Gemini TTS 요청 시간 초과");
        if (attempt >= 3) throw error instanceof Error ? error : new Error(String(error));
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(1_500 * (attempt + 1));
      }
    }

    throw lastError ?? new Error("Gemini TTS 요청 실패");
  }

  /** 최소 간격을 지키며 요청을 직렬화합니다. */
  private paced<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      return task();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send<T>(
    url: string,
    body: unknown,
  ): Promise<{ ok: boolean; status: number; raw: string; parsed: T | null }> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const raw = await response.text();
    let parsed: T | null = null;
    try {
      parsed = JSON.parse(raw) as T;
    } catch {
      parsed = null;
    }
    return { ok: response.ok, status: response.status, raw, parsed };
  }
}

/** 429 응답의 "Please retry in 28.06s" / "retry after 40s"를 읽어 대기 시간을 정합니다. */
export function retryDelayMs(message: string, status: number, attempt: number): number {
  const hint = /retry (?:in|after) ([\d.]+)\s*s/i.exec(message);
  if (hint?.[1]) return Math.min(45_000, Math.ceil(Number(hint[1]) * 1_000) + 1_500);
  return status === 429 ? 2_500 * (attempt + 1) : 1_500 * (attempt + 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
