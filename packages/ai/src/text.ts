/**
 * 프롬프트에 넣기 전에 긴 텍스트를 앞/뒤로 잘라냅니다.
 * 중간을 버리되 잘렸다는 사실을 프롬프트에 남겨 모델이 오해하지 않도록 합니다.
 */
export function truncateForPrompt(text: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };

  const headLength = Math.floor(maxChars * 0.7);
  const tailLength = maxChars - headLength;
  const head = normalized.slice(0, headLength);
  const tail = normalized.slice(-tailLength);
  return {
    text: `${head}\n\n[... 중략: 원문 ${normalized.length.toLocaleString()}자 중 일부 생략 ...]\n\n${tail}`,
    truncated: true,
  };
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** 한국어 제목/설명의 길이 제한을 안전하게 자릅니다. */
export function clampText(text: string, maxLength: number): string {
  const value = text.trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
