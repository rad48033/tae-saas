import type { AiProvider, CompletionRequest, CompletionResult } from "./types";

/**
 * 기본 모델은 최신 Flash 별칭입니다. 특정 버전이 신규 사용자에게 닫히는 일이 있어
 * (`gemini-2.5-flash` → `no longer available to new users`) 별칭을 기본값으로 두고,
 * 필요하면 `GEMINI_MODEL`로 고정합니다.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
/**
 * 기본 별칭이 혼잡(UNAVAILABLE)하거나 특정 버전이 신규 사용자에게 닫힐 때 쓸 대체 모델입니다.
 * (`gemini-flash-latest` → 503 high demand, `gemini-2.5-flash` → no longer available …)
 */
export const DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-3-flash-preview", "gemini-flash-lite-latest"] as const;
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiProviderOptions {
  apiKey: string;
  /** gemini-flash-latest | gemini-3.8-flash | gemini-2.5-pro 등 */
  model?: string;
  /** 모델이 혼잡·폐기일 때 순서대로 시도할 모델 */
  fallbackModels?: readonly string[];
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * 사고(thinking) 토큰 예산. 기본 0으로 꺼서 구조화 JSON 응답을 빨리 받습니다.
   * null 이면 지정하지 않습니다(모델 기본값).
   */
  thinkingBudget?: number | null;
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
  // 같은 모델을 오래 붙들지 않고, 혼잡하면 바로 다음 모델로 넘어갑니다.
  const modelChain = [model, ...(options.fallbackModels ?? DEFAULT_GEMINI_FALLBACK_MODELS)].filter(
    (value, index, list) => Boolean(value) && list.indexOf(value) === index,
  );

  return {
    id: "gemini",
    model,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const thinkingBudget = options.thinkingBudget === undefined ? 0 : options.thinkingBudget;
      const buildBody = (withThinking: boolean): Record<string, unknown> => ({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: request.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: 0.7,
          ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
          ...(request.json ? { responseMimeType: "application/json" } : {}),
          ...(withThinking && thinkingBudget !== null ? { thinkingConfig: { thinkingBudget } } : {}),
        },
      });

      let lastError: Error | null = null;
      let thinkingSupported = thinkingBudget !== null;

      for (const [index, candidateModel] of modelChain.entries()) {
        const isLast = index === modelChain.length - 1;
        let payload: GeminiResponse;
        try {
          payload = await requestWithRetry<GeminiResponse>({
            url: `${baseUrl}/models/${encodeURIComponent(candidateModel)}:generateContent`,
            apiKey: options.apiKey,
            body: JSON.stringify(buildBody(thinkingSupported)),
            timeoutMs,
            maxRetries: isLast ? maxRetries : 0,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // thinkingConfig 를 모르는 모델(lite 등)은 400 INVALID_ARGUMENT로 거절하므로
          // 그 필드만 빼고 같은 모델로 다시 보냅니다.
          const thinkingRejected = /thinking/i.test(message) || /INVALID_ARGUMENT|Gemini 400/i.test(message);
          if (thinkingSupported && thinkingRejected) {
            thinkingSupported = false;
            try {
              payload = await requestWithRetry<GeminiResponse>({
                url: `${baseUrl}/models/${encodeURIComponent(candidateModel)}:generateContent`,
                apiKey: options.apiKey,
                body: JSON.stringify(buildBody(false)),
                timeoutMs,
                maxRetries: isLast ? maxRetries : 0,
              });
            } catch (retryError) {
              if (!isLast && retryError instanceof Error && isModelSwitchable(retryError)) {
                lastError = retryError;
                continue;
              }
              throw retryError;
            }
          } else if (!isLast && error instanceof Error && isModelSwitchable(error)) {
            // 모델이 혼잡하거나 폐기됐으면 다음 모델로 넘어가고, 그 밖의 오류는 그대로 던집니다.
            lastError = error;
            continue;
          } else {
            throw error;
          }
        }

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
          model: payload.modelVersion ?? candidateModel,
          provider: "gemini",
          stopReason: candidate?.finishReason ?? null,
        };
      }

      throw lastError ?? new Error("Gemini 요청 실패");
    },
  };
}

/** 같은 요청을 다른 모델로 다시 보내도 되는 오류(혼잡·폐기·한도)인지 */
function isModelSwitchable(error: Error): boolean {
  return /Gemini (503|404|429)|UNAVAILABLE|high demand|no longer available|NOT_FOUND|RESOURCE_EXHAUSTED/i.test(
    error.message,
  );
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
