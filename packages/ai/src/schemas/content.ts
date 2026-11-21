import { z } from "zod";

/**
 * 하나의 유튜브 영상에서 뽑아내는 결과물은 발행 채널에 따라 구조가 다릅니다.
 *   blog      : SEO 블로그 포스팅
 *   instagram : 훅 + 카드뉴스(5~7장) + 캡션 + 해시태그
 *   facebook  : 스토리텔링 피드 글 + 핵심 불릿 + 댓글 유도 질문
 */

export const contentLanguageSchema = z.enum(["ko", "en"]);
export type ContentLanguage = z.infer<typeof contentLanguageSchema>;

export const contentFormatSchema = z.enum(["blog", "instagram", "facebook"]);
export type ContentFormat = z.infer<typeof contentFormatSchema>;

export const CONTENT_FORMATS: readonly ContentFormat[] = ["blog", "instagram", "facebook"] as const;

export function isContentFormat(value: string): value is ContentFormat {
  return (CONTENT_FORMATS as readonly string[]).includes(value);
}

// ── 블로그 ────────────────────────────────────────────────────────────────
export const blogSectionSchema = z.object({
  heading: z.string().min(1).max(120),
  points: z.array(z.string().min(1).max(300)).max(6).default([]),
});

export const blogDraftSchema = z.object({
  format: z.literal("blog"),
  language: contentLanguageSchema,
  title: z.string().min(4).max(120),
  slug: z.string().max(120).optional(),
  metaDescription: z.string().min(20).max(300),
  primaryKeyword: z.string().max(80).default(""),
  secondaryKeywords: z.array(z.string().max(80)).max(8).default([]),
  outline: z.array(blogSectionSchema).min(2).max(12),
  body: z.string().min(300),
  keyTakeaways: z.array(z.string().max(300)).max(6).default([]),
  faq: z.array(z.object({ question: z.string().max(200), answer: z.string().max(1200) })).max(6).default([]),
  tags: z.array(z.string().max(40)).min(1).max(12),
  readingTimeMinutes: z.number().int().min(1).max(120).optional(),
  seoNotes: z.string().max(600).optional(),
});

// ── 인스타그램 ────────────────────────────────────────────────────────────
export const instagramSlideSchema = z.object({
  index: z.number().int().min(1).max(10).default(1),
  title: z.string().min(1).max(80),
  body: z.string().max(400).default(""),
  /** 카드 디자인용 짧은 지시(선택) */
  visualHint: z.string().max(200).optional(),
});

export const instagramDraftSchema = z.object({
  format: z.literal("instagram"),
  language: contentLanguageSchema,
  hook: z.string().min(4).max(200),
  caption: z.string().min(20).max(2400),
  slides: z.array(instagramSlideSchema).min(3).max(8),
  cta: z.string().min(2).max(300),
  hashtags: z.array(z.string().max(60)).min(5).max(30),
  keywords: z.array(z.string().max(60)).max(10).default([]),
});

// ── 페이스북 ──────────────────────────────────────────────────────────────
export const facebookDraftSchema = z.object({
  format: z.literal("facebook"),
  language: contentLanguageSchema,
  headline: z.string().max(140).default(""),
  body: z.string().min(200).max(6000),
  bullets: z.array(z.string().max(300)).min(2).max(8),
  closingQuestion: z.string().min(5).max(300),
  hashtags: z.array(z.string().max(60)).max(8).default([]),
  linkTitle: z.string().max(140).optional(),
});

export const contentDraftSchema = z.discriminatedUnion("format", [
  blogDraftSchema,
  instagramDraftSchema,
  facebookDraftSchema,
]);

export type BlogSection = z.infer<typeof blogSectionSchema>;
export type BlogDraft = z.infer<typeof blogDraftSchema>;
export type InstagramSlide = z.infer<typeof instagramSlideSchema>;
export type InstagramDraft = z.infer<typeof instagramDraftSchema>;
export type FacebookDraft = z.infer<typeof facebookDraftSchema>;
export type ContentDraft = z.infer<typeof contentDraftSchema>;

const FORMAT_SCHEMAS = {
  blog: blogDraftSchema,
  instagram: instagramDraftSchema,
  facebook: facebookDraftSchema,
} as const;

/** 형식별로 정확한 스키마 타입을 돌려주는 오버로드 */
export function contentSchemaForFormat(format: "blog"): typeof blogDraftSchema;
export function contentSchemaForFormat(format: "instagram"): typeof instagramDraftSchema;
export function contentSchemaForFormat(format: "facebook"): typeof facebookDraftSchema;
export function contentSchemaForFormat(format: ContentFormat) {
  return FORMAT_SCHEMAS[format];
}

export const FORMAT_LABELS: Record<ContentFormat, { ko: string; en: string; description: string }> = {
  blog: { ko: "블로그 포스팅", en: "Blog post", description: "SEO 제목·메타 설명·목차·본문·태그" },
  instagram: { ko: "인스타 포스팅", en: "Instagram post", description: "훅 + 카드뉴스 5~7장 + 캡션 + 해시태그" },
  facebook: { ko: "페이스북 포스팅", en: "Facebook post", description: "스토리텔링 피드 글 + 핵심 불릿 + 질문" },
};
