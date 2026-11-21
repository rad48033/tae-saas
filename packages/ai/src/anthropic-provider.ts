import Anthropic from "@anthropic-ai/sdk";

import type { AiProvider, CompletionRequest, CompletionResult } from "./types";

export const DEFAULT_MODEL = "claude-sonnet-4-5";
export const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  /** SDK 자체 재시도(429/5xx) 횟수 */
  maxRetries?: number;
  /** 요청 타임아웃(ms) */
  timeoutMs?: number;
}

/**
 * Claude Messages API 래퍼.
 * - 시스템 프롬프트는 별도 필드로 전달합니다(Claude 권장 방식).
 * - 토큰 사용량을 그대로 반환해 과금·로깅에 씁니다.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const model = options.model?.trim() || DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: options.maxRetries ?? 2,
    timeout: options.timeoutMs ?? 90_000,
  });

  return {
    id: "anthropic",
    model,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const response = await client.messages.create({
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      return {
        text,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
        model,
        provider: "anthropic",
        stopReason: response.stop_reason ?? null,
      };
    },
  };
}
