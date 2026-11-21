/** AI 계층의 공통 타입. 앱은 이 인터페이스에만 의존합니다. */

export type AiProviderId = "anthropic" | "demo";

export interface CompletionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: CompletionMessage[];
  maxTokens?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
  model: string;
  provider: AiProviderId;
  stopReason: string | null;
}

/**
 * LLM 호출의 최소 단위. 테스트에서는 가짜 구현을 주입하고,
 * 운영에서는 AnthropicProvider를 사용합니다.
 */
export interface AiProvider {
  readonly id: AiProviderId;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
