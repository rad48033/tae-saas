import { describe, expect, it } from "vitest";

import type { ContentDraft } from "@tae/ai";

import {
  draftCharacterCounts,
  draftToDownload,
  draftToPlainText,
  facebookFeedLineCount,
  facebookFeedText,
} from "../src/lib/format-export";

const blog: ContentDraft = {
  format: "blog",
  language: "ko",
  title: "스타트업 첫 100일 생존 전략",
  slug: "startup-first-100-days",
  metaDescription: "첫 100일에 무엇을 해야 하는지 영상 자막을 근거로 정리했습니다.",
  primaryKeyword: "스타트업 100일",
  secondaryKeywords: ["고객 인터뷰"],
  executiveSummary: "첫 100일은 고객을 보는 시간입니다. 매주 5명을 만나고 기록을 남기면 다음 결정이 쉬워집니다.",
  outline: [{ heading: "고객을 보는 시간", points: ["매주 5명 인터뷰"] }],
  body: "## 고객을 보는 시간\n\n매주 5명의 고객과 이야기하세요.",
  keyTakeaways: ["고객 인터뷰가 먼저다"],
  faq: [{ question: "왜 100일인가요?", answer: "초기 학습 속도가 가장 빠른 구간이기 때문입니다." }],
  tags: ["스타트업", "고객개발"],
  readingTimeMinutes: 3,
};

const instagram: ContentDraft = {
  format: "instagram",
  language: "ko",
  hook: "첫 100일, 제품보다 고객입니다",
  caption: "첫 100일은 고객을 보는 시간입니다.\n\n매주 5명과 이야기하세요.",
  slides: [
    { index: 1, role: "cover", title: "표지", body: "첫 100일의 원칙" },
    { index: 2, role: "point", title: "핵심", body: "매주 5명 인터뷰" },
  ],
  cta: "저장해 두세요",
  hashtags: ["#스타트업", "#고객개발"],
  keywords: ["스타트업"],
};

const facebook: ContentDraft = {
  format: "facebook",
  language: "ko",
  headline: "첫 100일 동안 매주 5명을 만났습니다",
  body: "첫 100일은 제품보다 고객을 보는 시간입니다.\n\n매주 5명을 만나 기록했습니다.",
  bullets: ["매주 5명 인터뷰", "제품은 그다음"],
  closingQuestion: "여러분은 첫 100일에 무엇을 하셨나요?",
  hashtags: ["#스타트업"],
  linkTitle: "첫 100일 정리",
};

describe("draft exports", () => {
  it("serializes blog drafts with summary, tags, body and faq", () => {
    const text = draftToPlainText(blog);
    expect(text).toContain("스타트업 첫 100일 생존 전략");
    expect(text).toContain("#스타트업");
    expect(text).toContain("## 고객을 보는 시간");
    expect(text).toContain("첫 100일은 고객을 보는 시간입니다. 매주 5명을 만나고");
    expect(text).toContain("Q. 왜 100일인가요?");
  });

  it("builds a markdown download for blog posts", () => {
    const file = draftToDownload(blog);
    expect(file.fileName).toBe("startup-first-100-days.md");
    expect(file.content.startsWith("---")).toBe(true);
    expect(file.content).toContain('title: "스타트업 첫 100일 생존 전략"');
    expect(file.content).toContain("한눈에 보는 요약");
  });

  it("serializes instagram drafts with slides and hashtags", () => {
    const text = draftToPlainText(instagram);
    expect(text).toContain("[카드뉴스 2장]");
    expect(text).toContain("1. 표지");
    expect(text).toContain("#스타트업");
    const file = draftToDownload(instagram);
    expect(file.fileName).toMatch(/^instagram-\d{4}-\d{2}-\d{2}\.txt$/);
  });

  it("assembles the facebook feed in posting order", () => {
    const text = facebookFeedText(facebook);
    const headlineAt = text.indexOf("첫 100일 동안 매주 5명을 만났습니다");
    const bulletAt = text.indexOf("• 매주 5명 인터뷰");
    const questionAt = text.indexOf("여러분은 첫 100일에 무엇을 하셨나요?");
    const tagsAt = text.indexOf("#스타트업");
    expect(headlineAt).toBeGreaterThanOrEqual(0);
    expect(bulletAt).toBeGreaterThan(headlineAt);
    expect(questionAt).toBeGreaterThan(bulletAt);
    expect(tagsAt).toBeGreaterThan(questionAt);
    expect(draftToPlainText(facebook)).toBe(text);
  });

  it("counts non-empty feed lines for the ~20-line label", () => {
    const long: ContentDraft = {
      ...facebook,
      body: Array.from({ length: 12 }, (_, index) => `본문 줄 ${index + 1}`).join("\n\n"),
      bullets: ["하나", "둘", "셋", "넷", "다섯"],
    };
    // 헤드라인 1 + 본문 12 + 불릿 5 + 질문 1 = 19줄
    expect(facebookFeedLineCount(long)).toBe(19);
    // 헤드라인 1 + 본문 2 + 불릿 2 + 질문 1 = 6줄 (해시태그 줄은 제외)
    expect(facebookFeedLineCount(facebook)).toBe(6);
  });

  it("reports character counts per format", () => {
    expect(draftCharacterCounts(instagram)[0]).toMatchObject({ label: "캡션", limit: 2200 });
    expect(draftCharacterCounts(blog).map((item) => item.label)).toEqual(["제목", "메타 설명", "본문", "FAQ", "태그"]);
    expect(draftCharacterCounts(blog).find((item) => item.label === "FAQ")).toMatchObject({ count: 1, unit: "개" });
    expect(draftCharacterCounts(facebook).find((item) => item.label === "줄 수")).toMatchObject({ count: 6, unit: "줄" });
  });
});
