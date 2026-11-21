import { describe, expect, it } from "vitest";

import type { ContentDraft } from "@tae/ai";

import { draftCharacterCounts, draftToDownload, draftToPlainText } from "../src/lib/format-export";

const blog: ContentDraft = {
  format: "blog",
  language: "ko",
  title: "스타트업 첫 100일 생존 전략",
  slug: "startup-first-100-days",
  metaDescription: "첫 100일에 무엇을 해야 하는지 영상 자막을 근거로 정리했습니다.",
  primaryKeyword: "스타트업 100일",
  secondaryKeywords: ["고객 인터뷰"],
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
  caption: "첫 100일은 고객을 보는 시간입니다.\n매주 5명과 이야기하세요.",
  slides: [
    { index: 1, title: "표지", body: "첫 100일의 원칙" },
    { index: 2, title: "핵심", body: "매주 5명 인터뷰" },
  ],
  cta: "저장해 두세요",
  hashtags: ["#스타트업", "#고객개발"],
  keywords: ["스타트업"],
};

const facebook: ContentDraft = {
  format: "facebook",
  language: "ko",
  headline: "첫 100일 동안 매주 5명을 만났습니다",
  body: "첫 100일은 제품보다 고객을 보는 시간입니다.",
  bullets: ["매주 5명 인터뷰", "제품은 그다음"],
  closingQuestion: "여러분은 첫 100일에 무엇을 하셨나요?",
  hashtags: ["#스타트업"],
  linkTitle: "첫 100일 정리",
};

describe("draft exports", () => {
  it("serializes blog drafts with title, tags and body", () => {
    const text = draftToPlainText(blog);
    expect(text).toContain("스타트업 첫 100일 생존 전략");
    expect(text).toContain("#스타트업");
    expect(text).toContain("## 고객을 보는 시간");
  });

  it("builds a markdown download for blog posts", () => {
    const file = draftToDownload(blog);
    expect(file.fileName).toBe("startup-first-100-days.md");
    expect(file.content.startsWith("---")).toBe(true);
    expect(file.content).toContain('title: "스타트업 첫 100일 생존 전략"');
  });

  it("serializes instagram drafts with slides and hashtags", () => {
    const text = draftToPlainText(instagram);
    expect(text).toContain("1. 표지");
    expect(text).toContain("#스타트업");
    const file = draftToDownload(instagram);
    expect(file.fileName).toMatch(/^instagram-\d{4}-\d{2}-\d{2}\.txt$/);
  });

  it("serializes facebook drafts with bullets and a question", () => {
    const text = draftToPlainText(facebook);
    expect(text).toContain("- 매주 5명 인터뷰");
    expect(text).toContain("여러분은 첫 100일에 무엇을 하셨나요?");
  });

  it("reports character counts per format", () => {
    expect(draftCharacterCounts(instagram)[0]).toMatchObject({ label: "캡션", limit: 2200 });
    expect(draftCharacterCounts(blog).map((item) => item.label)).toEqual(["제목", "메타 설명"]);
  });
});
