import { completeJson } from "../json";
import { buildContentPrompt, type ContentGenerationInput } from "../prompts/content";
import {
  blogDraftSchema,
  facebookDraftSchema,
  instagramDraftSchema,
  type ContentDraft,
} from "../schemas/content";
import { clampText, countWords } from "../text";
import type { AiProvider, TokenUsage } from "../types";

export interface ContentGenerationResult {
  draft: ContentDraft;
  provider: AiProvider["id"];
  model: string;
  usage: TokenUsage;
  repaired: boolean;
}

/**
 * 선택한 발행 형식(blog | instagram | facebook)에 맞는 프롬프트와 스키마로
 * 한 번에 초안을 만듭니다. 형식별 스키마를 쓰기 때문에 검증 오류가 명확합니다.
 */
export async function generateContentWithProvider(
  provider: AiProvider,
  input: ContentGenerationInput,
): Promise<ContentGenerationResult> {
  const prompt = buildContentPrompt(input);
  const request = { system: prompt.system, prompt: prompt.prompt, maxTokens: prompt.maxTokens };

  if (input.target.format === "blog") {
    const result = await completeJson(provider, request, blogDraftSchema);
    return {
      draft: normalizeBlogDraft(result.value, input),
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      repaired: result.repaired,
    };
  }

  if (input.target.format === "instagram") {
    const result = await completeJson(provider, request, instagramDraftSchema);
    return {
      draft: normalizeInstagramDraft(result.value, input),
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      repaired: result.repaired,
    };
  }

  const result = await completeJson(provider, request, facebookDraftSchema);
  return {
    draft: normalizeFacebookDraft(result.value, input),
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    repaired: result.repaired,
  };
}

export function normalizeContent(draft: ContentDraft, input: ContentGenerationInput): ContentDraft {
  switch (draft.format) {
    case "blog":
      return normalizeBlogDraft(draft, input);
    case "instagram":
      return normalizeInstagramDraft(draft, input);
    case "facebook":
      return normalizeFacebookDraft(draft, input);
  }
}

export function normalizeBlogDraft(
  draft: Extract<ContentDraft, { format: "blog" }>,
  input: ContentGenerationInput,
): Extract<ContentDraft, { format: "blog" }> {
  const tags = dedupe(draft.tags.map((tag) => tag.replace(/^#/, "").trim())).slice(0, 10);
  const body = draft.body.trim();

  const outline = draft.outline
    .map((section) => ({
      heading: section.heading.trim(),
      points: dedupe(section.points.map((point) => point.trim())),
    }))
    .filter((section) => section.heading.length > 0);

  return {
    ...draft,
    format: "blog",
    language: input.target.language,
    title: clampText(draft.title, 100),
    slug: normalizeSlug(draft.slug, draft.primaryKeyword || draft.title),
    metaDescription: clampText(draft.metaDescription, 170),
    primaryKeyword: draft.primaryKeyword.trim() || input.target.focusKeyword || tags[0] || "",
    secondaryKeywords: dedupe(draft.secondaryKeywords.map((value) => value.trim())),
    executiveSummary: draft.executiveSummary.trim(),
    keyTakeaways: draft.keyTakeaways.map((item) => item.trim()).filter(Boolean).slice(0, 6),
    outline,
    body,
    tags: tags.length > 0 ? tags : ["유튜브", "블로그", "콘텐츠"],
    readingTimeMinutes: draft.readingTimeMinutes ?? Math.max(1, Math.ceil(countWords(body) / 500)),
  };
}

export function normalizeInstagramDraft(
  draft: Extract<ContentDraft, { format: "instagram" }>,
  input: ContentGenerationInput,
): Extract<ContentDraft, { format: "instagram" }> {
  // 카드뉴스는 10장이 기본. 모델이 11~12장을 주면 마지막 장(요약·CTA)을 버리지 않도록 그대로 살립니다.
  const slides = draft.slides.slice(0, 12).map((slide, index) => ({
    index: index + 1,
    ...(slide.role ? { role: slide.role } : {}),
    title: clampText(slide.title, 60),
    body: clampText(slide.body, 220),
    ...(slide.visualHint ? { visualHint: clampText(slide.visualHint, 160) } : {}),
  }));

  return {
    ...draft,
    format: "instagram",
    language: input.target.language,
    hook: clampText(draft.hook, 150),
    caption: clampText(draft.caption, 2200),
    slides,
    cta: clampText(draft.cta, 200),
    hashtags: normalizeHashtags(draft.hashtags, 20),
    keywords: dedupe(draft.keywords.map((keyword) => keyword.trim())).slice(0, 10),
  };
}

export function normalizeFacebookDraft(
  draft: Extract<ContentDraft, { format: "facebook" }>,
  input: ContentGenerationInput,
): Extract<ContentDraft, { format: "facebook" }> {
  const closing = draft.closingQuestion.trim();
  return {
    ...draft,
    format: "facebook",
    language: input.target.language,
    headline: clampText(draft.headline, 100),
    body: clampText(draft.body, 5500),
    bullets: dedupe(draft.bullets.map((bullet) => bullet.trim())).slice(0, 6),
    closingQuestion: closing.endsWith("?") || closing.endsWith("？") ? closing : `${closing}?`,
    hashtags: normalizeHashtags(draft.hashtags, 5),
  };
}

export function normalizeHashtags(values: string[], max: number): string[] {
  const cleaned = values
    .flatMap((value) => value.split(/[\s,]+/))
    .map((value) => value.replace(/^#+/, "").trim())
    .filter((value) => value.length > 0 && value.length <= 40);

  return dedupe(cleaned)
    .slice(0, max)
    .map((value) => `#${value}`);
}

export function normalizeSlug(slug: string | undefined, fallback: string): string {
  const candidate = (slug ?? "").trim().toLowerCase();
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate) && candidate.length >= 3 && candidate.length <= 60) {
    return candidate;
  }

  const ascii = fallback
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (ascii.length >= 3) return ascii.slice(0, 60).replace(/-$/, "");
  return `post-${shortHash(fallback)}`;
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 6).padEnd(6, "0");
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
