import type { z, ZodTypeAny } from "zod";

import type { AiProvider, TokenUsage } from "./types";

export class AiResponseError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AiResponseError";
  }
}

/**
 * 모델이 코드펜스나 설명을 섞어 보내도 첫 JSON 값을 건져냅니다.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new AiResponseError("빈 응답", "모델이 아무 텍스트도 반환하지 않았습니다.");

  const withoutFence = trimmed
    .replace(/^```(?:json|JSON)?\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  const direct = tryParse(withoutFence);
  if (direct !== undefined) return direct;

  const start = firstJsonStart(withoutFence);
  if (start === -1) {
    throw new AiResponseError("JSON을 찾을 수 없음", withoutFence.slice(0, 200));
  }

  // 뒤에서부터 닫는 괄호를 줄여가며 균형이 맞는 첫 JSON을 찾습니다.
  for (let end = withoutFence.length; end > start; end -= 1) {
    const candidate = withoutFence.slice(start, end).trim();
    if (!candidate.endsWith("}") && !candidate.endsWith("]")) continue;
    const parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;
  }

  throw new AiResponseError("JSON 파싱 실패", withoutFence.slice(0, 200));
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function firstJsonStart(value: string): number {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  if (objectStart === -1) return arrayStart;
  if (arrayStart === -1) return objectStart;
  return Math.min(objectStart, arrayStart);
}

export interface CompleteJsonOptions {
  /** 스키마 위반 시 교정 요청을 몇 번까지 허용할지 (기본 1회) */
  repairs?: number;
}

export interface CompleteJsonResult<T> {
  value: T;
  usage: TokenUsage;
  model: string;
  provider: AiProvider["id"];
  repaired: boolean;
  raw: string;
}

/**
 * JSON 응답을 요구하는 호출. 검증에 실패하면 모델에게 오류를 알려주고
 * 한 번 더 교정을 요청합니다(비용이 들므로 기본 1회).
 */
export async function completeJson<S extends ZodTypeAny>(
  provider: AiProvider,
  request: { system: string; prompt: string; maxTokens?: number },
  schema: S,
  options: CompleteJsonOptions = {},
): Promise<CompleteJsonResult<z.output<S>>> {
  const repairs = options.repairs ?? 1;
  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: request.prompt },
  ];

  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let lastError = "알 수 없는 오류";
  let lastRaw = "";

  for (let attempt = 0; attempt <= repairs; attempt += 1) {
    const result = await provider.complete({
      system: request.system,
      messages,
      maxTokens: request.maxTokens,
      json: true,
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    lastRaw = result.text;

    try {
      const parsed = extractJson(result.text);
      const validated = schema.safeParse(parsed);
      if (validated.success) {
        return {
          value: validated.data,
          usage,
          model: result.model,
          provider: result.provider,
          repaired: attempt > 0,
          raw: result.text,
        };
      }
      lastError = formatZodError(validated.error);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < repairs) {
      messages.push({ role: "assistant", content: result.text.slice(0, 20_000) });
      messages.push({
        role: "user",
        content:
          "이전 응답이 요구된 JSON 스키마와 맞지 않습니다. 아래 오류를 고쳐서, 설명 없이 JSON 객체 하나만 다시 출력하세요.\n\n" +
          `오류: ${lastError}`,
      });
    }
  }

  throw new AiResponseError("모델 응답이 스키마를 만족하지 않음", `${lastError}\n\n${lastRaw.slice(0, 500)}`);
}

function formatZodError(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
