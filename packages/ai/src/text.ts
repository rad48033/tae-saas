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

// ── 해시태그·원문 정리 ────────────────────────────────────────────────────
//
// 인스타그램 캡션에는 "#쁘띠앤락토프리미엄,온가족"처럼 태그가 쉼표로 붙어 오고,
// 나레이션·본문에는 이모지와 @멘션이 그대로 섞여 옵니다. 그대로 두면
//   - 해시태그 스키마(max 60자)를 넘거나 "#태그,태그"가 한 태그로 저장되고,
//   - TTS·자막이 "#쁘띠앤서포터즈"를 소리 내어 읽습니다.
// 그래서 태그/문장을 쓰기 직전에 한 번씩 정리합니다.

const EMOJI_PATTERN =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu;

/** 해시태그 하나로 쓸 수 있게 정리합니다. 쓸 수 없으면 null. */
export function sanitizeHashtag(value: string): string | null {
  const cleaned = value
    .replace(/^[#\s]+/, "")
    .replace(EMOJI_PATTERN, "")
    .replace(/[^\p{L}\p{N}_]+/gu, "")
    .trim();

  if (cleaned.length < 1 || cleaned.length > 40) return null;
  return cleaned;
}

/**
 * 모델·캡션에서 온 태그 목록을 "#a, b #c" 형태에서도 안전하게 나눕니다.
 * 쉼표·공백·파이프·#·가운뎃점을 구분자로 보고, 각 조각을 해시태그로 정리합니다.
 */
export function splitHashtagInput(values: string[]): string[] {
  const tokens = values.flatMap((value) => String(value ?? "").split(/[\s,#|·、，;:]+/u));
  const cleaned = tokens
    .map((token) => sanitizeHashtag(token))
    .filter((token): token is string => Boolean(token));
  return Array.from(new Set(cleaned));
}

/**
 * 블로그 태그처럼 띄어쓰기를 허용하는 짧은 키워드를 정리합니다.
 * 쉼표·따옴표·이모지는 지우고, 남은 공백은 한 칸으로 줄입니다.
 */
export function sanitizeTagPhrase(value: string): string | null {
  const cleaned = String(value ?? "")
    .replace(EMOJI_PATTERN, " ")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 2 || cleaned.length > 40) return null;
  return cleaned;
}

/**
 * 나레이션·자막에 남으면 안 되는 소셜 표기를 걷어냅니다.
 * 해시태그, @멘션, URL, 이모지, 목록 기호를 지우고 공백을 정리합니다.
 * 숫자·퍼센트·단위는 그대로 둡니다("100%", "450억" 등).
 */
export function stripSocialNoise(text: string): string {
  const cleaned = String(text ?? "")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/\bwww\.\S+/gu, " ")
    // 해시태그: '#' 뒤의 글자·숫자만 (한글 포함)
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    // 멘션: '@' 뒤의 계정명
    .replace(/@[\p{L}\p{N}_.]+/gu, " ")
    .replace(EMOJI_PATTERN, " ")
    .replace(/[✔✅☑▶►▸•·▪︎★☆※→←↑↓|｜~〜]/gu, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?。？！、，])/g, "$1")
    .replace(/([,;:])\1+/g, "$1")
    .replace(/^[\s,.;:!?|·\-–—]+/u, "")
    .replace(/[\s,;:|·\-–—]+$/u, "")
    .trim();

  return cleaned;
}

/** 문장에 실제 내용이 남아 있는지 (해시태그·이모지만 있던 줄 걸러내기) */
export function hasReadableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(stripSocialNoise(text));
}
