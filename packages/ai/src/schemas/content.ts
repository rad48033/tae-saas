import { z } from "zod";

/**
 * 하나의 유튜브 영상에서 뽑아내는 결과물은 발행 채널에 따라 구조가 다릅니다.
 *   blog      : 인플루언서급 장문 SEO 포스팅 (2,000~3,500자, H2 4~5개, FAQ 3~5개, 태그 8~10개)
 *   instagram : 훅 + 카드뉴스 10장 + 멀티 패러그래프 캡션 + 해시태그 15~20개
 *   facebook  : 약 20줄 스토리텔링 피드 글 + 핵심 불릿 + 댓글 유도 질문
 *
 * 하한(min)은 "명백한 미달"만 막는 안전선입니다. 스키마 검증에 실패하면
 * completeJson이 모델에 교정을 한 번 더 요청하므로, 지나치게 빡빡한 하한은
 * 사용자 크레딧을 두 번 쓰게 만듭니다. 그래서 분량 목표는 프롬프트에서 강하게
 * 지시하고, 스키마는 구조(섹션 수·슬라이드 수·FAQ 수)를 지키는 데 집중합니다.
 */

export const contentLanguageSchema = z.enum(["ko", "en"]);
export type ContentLanguage = z.infer<typeof contentLanguageSchema>;

export const contentFormatSchema = z.enum(["blog", "instagram", "facebook"]);
export type ContentFormat = z.infer<typeof contentFormatSchema>;

export const CONTENT_FORMATS: readonly ContentFormat[] = ["blog", "instagram", "facebook"] as const;

export function isContentFormat(value: string): value is ContentFormat {
  return (CONTENT_FORMATS as readonly string[]).includes(value);
}

/** 채널별 목표 분량/구성. 프롬프트·UI·테스트가 같은 숫자를 참조합니다. */
export const CONTENT_SPECS = {
  blog: {
    bodyChars: { min: 2000, max: 3500 },
    sections: { min: 4, max: 5 },
    faq: { min: 3, max: 5 },
    tags: { min: 8, max: 10 },
  },
  instagram: {
    slides: 10,
    captionChars: { min: 700, max: 2000 },
    hashtags: { min: 15, max: 20 },
  },
  facebook: {
    lines: 20,
    bullets: { min: 4, max: 6 },
  },
} as const;

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
  /** 본문 위 요약 박스: 2~4문장의 임원 요약(prose) */
  executiveSummary: z.string().max(800).default(""),
  outline: z.array(blogSectionSchema).min(4).max(8),
  /** 마크다운 본문. 2,000~3,500자를 목표로 하고 1,800자 미만은 미달로 봅니다. */
  body: z.string().min(1800),
  keyTakeaways: z.array(z.string().max(300)).min(3).max(6),
  faq: z
    .array(z.object({ question: z.string().min(2).max(200), answer: z.string().min(2).max(1200) }))
    .min(3)
    .max(6),
  tags: z.array(z.string().max(40)).min(8).max(12),
  readingTimeMinutes: z.number().int().min(1).max(120).optional(),
  seoNotes: z.string().max(600).optional(),
});

// ── 인스타그램 ────────────────────────────────────────────────────────────
export const instagramSlideRoleSchema = z.enum(["cover", "point", "caveat", "summary"]);
export type InstagramSlideRole = z.infer<typeof instagramSlideRoleSchema>;

export const instagramSlideSchema = z.object({
  index: z.number().int().min(1).max(20).default(1),
  /** 1=표지, 2~8=핵심 포인트, 9=주의·팁, 10=요약·CTA */
  role: instagramSlideRoleSchema.optional(),
  title: z.string().min(1).max(80),
  body: z.string().max(400).default(""),
  /** 카드 디자인용 짧은 지시(선택) */
  visualHint: z.string().max(200).optional(),
});

export const instagramDraftSchema = z.object({
  format: z.literal("instagram"),
  language: contentLanguageSchema,
  hook: z.string().min(4).max(200),
  caption: z.string().min(200).max(2200),
  /** 카드뉴스는 10장이 기본. 11~12장까지는 허용하고 그 이상은 잘라냅니다. */
  slides: z.array(instagramSlideSchema).min(10).max(12),
  cta: z.string().min(2).max(300),
  hashtags: z.array(z.string().max(60)).min(15).max(20),
  keywords: z.array(z.string().max(60)).max(10).default([]),
});

// ── 페이스북 ──────────────────────────────────────────────────────────────
export const facebookDraftSchema = z.object({
  format: z.literal("facebook"),
  language: contentLanguageSchema,
  /** 피드 첫 줄(훅). 비우면 본문 첫 줄을 그대로 씁니다. */
  headline: z.string().max(140).default(""),
  /** 줄바꿈으로 끊은 스토리 본문. 불릿·질문까지 합쳐 약 20줄이 되도록 씁니다. */
  body: z.string().min(400).max(6000),
  bullets: z.array(z.string().min(1).max(300)).min(3).max(8),
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
  blog: {
    ko: "블로그 포스팅",
    en: "Blog post",
    description: "인플루언서급 장문 SEO 글 · 본문 2,000~3,500자 · H2 4~5개 · FAQ 3~5개 · 태그 8~10개",
  },
  instagram: {
    ko: "인스타 포스팅",
    en: "Instagram post",
    description: "훅 + 카드뉴스 10장 + 멀티 패러그래프 캡션 + 해시태그 15~20개",
  },
  facebook: {
    ko: "페이스북 포스팅",
    en: "Facebook post",
    description: "약 20줄 스토리텔링 피드 + 핵심 불릿 + 댓글 유도 질문",
  },
};
