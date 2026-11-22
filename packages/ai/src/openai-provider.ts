import type { AiProvider, CompletionRequest, CompletionResult } from "./types";

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIProviderOptions {
  apiKey: string;
  /** gpt-4o-mini | gpt-4o | gpt-5.4-mini 등 */
  model?: string;
  /** 호환 게이트웨이를 쓸 때 (OPENAI_BASE_URL) */
  baseUrl?: string;
  /** 요청 타임아웃(ms) */
  timeoutMs?: number;
  /** 429/5xx 재시도 횟수 */
  maxRetries?: number;
}

interface ChatCompletionResponse {
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string; type?: string; code?: string };
}

/**
 * OpenAI Chat Completions 래퍼.
 *
 * Claude 어댑터와 같은 `AiProvider` 계약을 따르므로 `packages/ai`의 프롬프트·Zod 검증·
 * 교정 루프를 그대로 재사용합니다. 시스템 프롬프트는 첫 `system` 메시지로 보냅니다.
 *
 * - `json: true`면 `response_format: { type: "json_object" }`로 JSON 모드를 켭니다.
 * - gpt-5 이상·추론 모델은 `max_tokens` 대신 `max_completion_tokens`를 씁니다.
 * - 잔액 부족(`insufficient_quota`)이나 키 오류는 그대로 던집니다. 조용히 데모로
 *   넘어가면 결제 문제를 놓치기 때문입니다.
 */
export function createOpenAIProvider(options: OpenAIProviderOptions): AiProvider {
  const model = options.model?.trim() || DEFAULT_OPENAI_MODEL;
  const baseUrl = (options.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxRetries = options.maxRetries ?? 2;

  return {
    id: "openai",
    model,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: "system", content: request.system },
          ...request.messages.map((message) => ({ role: message.role, content: message.content })),
        ],
      };

      const maxTokens = request.maxTokens;
      if (maxTokens) {
        if (usesMaxCompletionTokens(model)) body.max_completion_tokens = maxTokens;
        else body.max_tokens = maxTokens;
      }
      if (request.json) body.response_format = { type: "json_object" };

      const payload = await requestWithRetry<ChatCompletionResponse>({
        url: `${baseUrl}/chat/completions`,
        apiKey: options.apiKey,
        body: JSON.stringify(body),
        timeoutMs,
        maxRetries,
        label: "OpenAI Chat",
      });

      const choice = payload.choices?.[0];
      const text = (choice?.message?.content ?? "").trim();
      if (!text) {
        const refusal = choice?.message?.refusal?.trim();
        throw new Error(refusal ? `OpenAI Chat 거절: ${refusal}` : "OpenAI Chat이 빈 응답을 반환했습니다.");
      }

      return {
        text,
        usage: {
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
        },
        model: payload.model ?? model,
        provider: "openai",
        stopReason: choice?.finish_reason ?? null,
      };
    },
  };
}

/** gpt-5 / o-시리즈는 max_tokens를 거부하고 max_completion_tokens를 요구합니다. */
function usesMaxCompletionTokens(model: string): boolean {
  return /^(gpt-5|o[1-9]|gpt-6)/i.test(model);
}

interface RawRequestOptions {
  url: string;
  apiKey: string;
  body: string;
  timeoutMs: number;
  maxRetries: number;
  label: string;
}

export async function requestWithRetry<T extends { error?: { message?: string } }>(
  options: RawRequestOptions,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: options.body,
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      const text = await response.text();
      let parsed: T | null = null;
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        parsed = null;
      }

      if (!response.ok) {
        const message = parsed?.error?.message ?? text.slice(0, 300);
        if ((response.status === 429 || response.status >= 500) && attempt < options.maxRetries) {
          await sleep(1_500 * (attempt + 1));
          lastError = new Error(`${options.label} ${response.status}: ${message}`);
          continue;
        }
        throw new Error(`${options.label} ${response.status}: ${message}`);
      }

      if (!parsed) throw new Error(`${options.label} 응답을 JSON으로 읽지 못했습니다.`);
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${options.label} 요청 시간 초과`);
      }
      if (attempt >= options.maxRetries) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      await sleep(1_500 * (attempt + 1));
    }
  }

  throw lastError ?? new Error(`${options.label} 요청 실패`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
