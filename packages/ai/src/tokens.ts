import type { TokenUsage } from "./types";

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** USD / 1M tokens. 모델이 목록에 없으면 Sonnet 가격으로 계산합니다. */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-opus-4-1": { inputPerMTok: 15, outputPerMTok: 75 },
  // OpenAI (근사치: 실제 청구액은 제공자 콘솔 기준)
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  // Gemini (근사치)
  "gemini-flash-latest": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-3.8-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
};

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-5"];
  if (!pricing) return 0;
  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** 대략적인 토큰 수 추정(한국어는 문자당 토큰이 더 많습니다). */
export function estimateTokens(text: string): number {
  const korean = (text.match(/[\u3131-\uD79D]/g) ?? []).length;
  const rest = text.length - korean;
  return Math.ceil(korean / 1.5 + rest / 4);
}
