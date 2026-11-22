import type { AiProvider, CompletionRequest, CompletionResult } from "./types";

/**
 * 기본 모델은 최신 Flash 별칭입니다. 특정 버전이 신규 사용자에게 닫히는 일이 있어
 * (`gemini-2.5-flash` → `no longer available to new users`) 별칭을 기본값으로 두고,
 * 필요하면 `GEMINI_MODEL`로 고정합니다.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiProviderOptions {
  apiKey: string;
  /** gemini-flash-latest | gemini-3.8-flash | gemini-2.5-pro 등 */
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface GeminiPart {
  text?: string;
  /** 사고 요약 파트는 본문이 아니므로 제외합니다. */
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[]; role?: string };
    finishReason?: string | null;
    finishMessage?: string | null;
  }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Google Gemini `generateContent` 래퍼.
 *
 * Claude·OpenAI 어댑터와 같은 `AiProvider` 계약을 따릅니다.
 * - 시스템 프롬프트는 `systemInstruction`으로 전달합니다.
 * - 대화의 `assistant` 턴은 Gemini 역할 `model`로 매핑합니다(교정 루프 유지).
 * - `json: true`면 `responseMimeType: "application/json"`으로 JSON만 출력하게 합니다.
 * - 안전 정책으로 후보가 비면 `promptFeedback.blockReason`을 담아 던집니다.
 */
export function createGeminiProvider(options: GeminiProviderOptions): AiProvider {
  const model = options.model?.trim() || DEFAULT_GEMINI_MODEL;
  const baseUrl = (options.baseUrl?.trim() || DEFAULT_GEMINI_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxRetries = options.maxRetries ?? 2;

  return {
    id: "gemini",
    model,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: request.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: 0.7,
          ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
          ...(request.json ? { responseMimeType: "application/json" } : {}),
        },
      };

      const payload = await requestWithRetry<GeminiResponse>({
        url: `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        apiKey: options.apiKey,
        body: JSON.stringify(body),
        timeoutMs,
        maxRetries,
      });

      const candidate = payload.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .filter((part) => !part.thought && typeof part.text === "string")
        .map((part) => part.text ?? "")
        .join("")
        .trim();

      if (!text) {
        const block = payload.promptFeedback?.blockReason;
        const blockMessage = payload.promptFeedback?.blockReasonMessage;
        const finish = candidate?.finishReason;
        const detail = [block && `차단: ${block}`, blockMessage, finish && `종료 사유: ${finish}`]
          .filter(Boolean)
          .join(" · ");
        throw new Error(`Gemini가 본문을 반환하지 않았습니다${detail ? ` (${detail})` : ""}`);
      }

      return {
        text,
        usage: {
          inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
          outputTokens:
            (payload.usageMetadata?.candidatesTokenCount ?? 0) +
            (payload.usageMetadata?.thoughtsTokenCount ?? 0),
        },
        model: payload.modelVersion ?? model,
        provider: "gemini",
        stopReason: candidate?.finishReason ?? null,
      };
    },
  };
}

interface RawRequestOptions {
  url: string;
  apiKey: string;
  body: string;
  timeoutMs: number;
  maxRetries: number;
}

async function requestWithRetry<T extends { error?: { message?: string; status?: string } }>(
  options: RawRequestOptions,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers: { "x-goog-api-key": options.apiKey, "content-type": "application/json" },
        body: options.body,
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      const raw = await response.text();
      let parsed: T | null = null;
      try {
        parsed = JSON.parse(raw) as T;
      } catch {
        parsed = null;
      }

      if (!response.ok) {
        const message = parsed?.error?.message ?? raw.slice(0, 300);
        const status = parsed?.error?.status ?? "";
        // 5xx는 일시 장애, 429는 분당 한도일 수 있어 한 번만 기다립니다.
        const retryable = response.status >= 500 || (response.status === 429 && attempt === 0);
        if (retryable && attempt < options.maxRetries) {
          await sleep(response.status === 429 ? 2_500 : 1_500 * (attempt + 1));
          lastError = new Error(`Gemini ${response.status}${status ? ` ${status}` : ""}: ${message}`);
          continue;
        }
        throw new Error(`Gemini ${response.status}${status ? ` ${status}` : ""}: ${message}`);
      }

      if (!parsed) throw new Error("Gemini 응답을 JSON으로 읽지 못했습니다.");
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Gemini 요청 시간 초과");
      }
      if (attempt >= options.maxRetries) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      await sleep(1_500 * (attempt + 1));
    }
  }

  throw lastError ?? new Error("Gemini 요청 실패");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
