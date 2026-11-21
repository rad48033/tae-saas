import { describe, expect, it } from "vitest";

import { estimateCostUsd, estimateTokens } from "../src/tokens";
import {
  normalizeFacebookDraft,
  normalizeHashtags,
  normalizeInstagramDraft,
  normalizeSlug,
} from "../src/services/content";
import { clampText, normalizeWhitespace, truncateForPrompt } from "../src/text";
import type { ContentGenerationInput } from "../src/prompts/youtube";
import type { FacebookDraft, InstagramDraft } from "../src/schemas/content";

const input: ContentGenerationInput = {
  video: { id: "v", url: "https://youtu.be/v", title: "t", channelTitle: "c" },
  transcript: { language: "ko", text: "본문", segments: [] },
  target: { language: "ko", format: "blog" },
};

describe("pricing", () => {
  it("calculates Sonnet cost per million tokens", () => {
    expect(estimateCostUsd("claude-sonnet-4-5", { inputTokens: 100_000, outputTokens: 20_000 })).toBeCloseTo(0.6, 5);
  });

  it("falls back to Sonnet pricing for unknown models", () => {
    expect(estimateCostUsd("unknown-model", { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(3, 5);
  });

  it("estimates more tokens for Korean text", () => {
    expect(estimateTokens("안녕하세요 반갑습니다")).toBeGreaterThan(estimateTokens("hello there"));
  });
});

describe("text helpers", () => {
  it("normalizes whitespace but keeps paragraph breaks", () => {
    expect(normalizeWhitespace("a   b\n\n\n\nc")).toBe("a b\n\nc");
  });

  it("truncates in the middle and marks it", () => {
    const { text, truncated } = truncateForPrompt("x".repeat(500), 100);
    expect(truncated).toBe(true);
    expect(text).toContain("중략");
    expect(text.length).toBeLessThan(200);
  });

  it("clamps long text with an ellipsis", () => {
    expect(clampText("가나다라마바사", 5)).toBe("가나다라…");
  });
});

describe("normalizeSlug", () => {
  it("keeps valid slugs", () => {
    expect(normalizeSlug("nextjs-cache-guide", "무시")).toBe("nextjs-cache-guide");
  });

  it("derives an ASCII slug from a Latin title", () => {
    expect(normalizeSlug(undefined, "Next.js 15 Cache")).toBe("next-js-15-cache");
  });

  it("falls back to a hash for pure Korean", () => {
    expect(normalizeSlug("한글 제목", "한글 제목")).toMatch(/^post-[a-z0-9]{6}$/);
  });
});

describe("hashtag normalization", () => {
  it("adds #, dedupes and caps the list", () => {
    const tags = normalizeHashtags(["#유튜브", "유튜브", "#블로그", "  ", "#마케팅"], 2);
    expect(tags).toEqual(["#유튜브", "#블로그"]);
  });

  it("splits space separated hashtags", () => {
    expect(normalizeHashtags(["#a #b #c"], 10)).toEqual(["#a", "#b", "#c"]);
  });
});

describe("instagram normalization", () => {
  it("reindexes slides, keeps 10-slide carousels intact and clamps lengths", () => {
    const draft: InstagramDraft = {
      format: "instagram",
      language: "ko",
      hook: "훅".repeat(100),
      caption: "캡션".repeat(2000),
      slides: Array.from({ length: 10 }, (_, index) => ({
        index: index + 5,
        role: index === 0 ? ("cover" as const) : index === 9 ? ("summary" as const) : ("point" as const),
        title: "제목".repeat(50),
        body: "본문".repeat(200),
      })),
      cta: "저장",
      hashtags: ["#a"],
      keywords: [],
    };
    const normalized = normalizeInstagramDraft(draft, input);
    expect(normalized.slides).toHaveLength(10);
    expect(normalized.slides[0]?.index).toBe(1);
    expect(normalized.slides[9]?.index).toBe(10);
    expect(normalized.slides[0]?.role).toBe("cover");
    expect(normalized.slides[9]?.role).toBe("summary");
    expect(normalized.caption.length).toBeLessThanOrEqual(2200);
    expect(normalized.slides[0]?.title.length).toBeLessThanOrEqual(60);
  });

  it("keeps up to 12 slides instead of dropping the closing slide", () => {
    const draft: InstagramDraft = {
      format: "instagram",
      language: "ko",
      hook: "훅",
      caption: "캡션".repeat(100),
      slides: Array.from({ length: 14 }, (_, index) => ({
        index: index + 1,
        title: `슬라이드 ${index + 1}`,
        body: "본문",
      })),
      cta: "저장",
      hashtags: ["#a"],
      keywords: [],
    };
    const normalized = normalizeInstagramDraft(draft, input);
    expect(normalized.slides).toHaveLength(12);
    expect(normalized.slides.at(-1)?.index).toBe(12);
  });
});

describe("facebook normalization", () => {
  it("ensures the closing question ends with a question mark", () => {
    const draft: FacebookDraft = {
      format: "facebook",
      language: "ko",
      headline: "헤드라인",
      body: "본문",
      bullets: ["하나", "하나", "둘"],
      closingQuestion: "여러분은 어떻게 생각하세요",
      hashtags: ["#a", "#a", "#b"],
    };
    const normalized = normalizeFacebookDraft(draft, input);
    expect(normalized.closingQuestion).toBe("여러분은 어떻게 생각하세요?");
    expect(normalized.bullets).toEqual(["하나", "둘"]);
    expect(normalized.hashtags).toEqual(["#a", "#b"]);
  });
});
