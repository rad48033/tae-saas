import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildDemoContent, type ContentDraft, type ContentFormat } from "@tae/ai";

import { ResultView } from "../src/components/result-view";
import type { ConvertResult } from "../src/components/converter";

const baseInput = {
  source: {
    sourceType: "youtube" as const,
    id: "abc123",
    url: "https://www.youtube.com/watch?v=abc123",
    title: "Next.js 15 캐시 완전 정리",
    author: "프론트엔드 채널",
    language: "ko" as const,
    text: "Next.js 15에서는 fetch 캐시가 기본으로 꺼져 있습니다. 그래서 매 요청이 새로 실행됩니다. 캐시를 쓰려면 옵션을 명시해야 합니다. revalidate 옵션으로 주기를 정할 수 있습니다. 라우트 세그먼트 단위 캐시도 함께 이해해야 합니다. 배포 후에는 실제 응답 헤더로 캐시 상태를 확인하세요.",
    segments: [],
  },
};

function render(format: ContentFormat): string {
  const draft = buildDemoContent({
    ...baseInput,
    target: { language: "ko", format },
  }) as ContentDraft;

  const result: ConvertResult = {
    jobId: "job_1",
    format,
    draft,
    video: null,
    source: {
      sourceType: "youtube",
      title: baseInput.source.title,
      author: baseInput.source.author,
      url: baseInput.source.url,
      thumbnailUrl: null,
      textChars: baseInput.source.text.length,
      textSource: "transcript",
      warnings: [],
    },
    credits: { remaining: 1, charged: 1 },
    meta: {
      provider: "demo",
      model: "demo-heuristic",
      mode: "demo",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 1200,
    },
  };

  return renderToStaticMarkup(<ResultView result={result} />);
}

describe("ResultView", () => {
  it("renders the long-form blog layout with summary, sections, faq and tags", () => {
    const html = render("blog");
    expect(html).toContain("한눈에 보는 요약");
    expect(html).toMatch(/본문 2,\d{3}자/);
    expect(html).toContain("H2 5개");
    expect(html).toContain("FAQ 4개");
    expect(html).toContain("SEO 태그 10개");
    expect(html).toContain("자주 묻는 질문 4개");
  });

  it("renders ten carousel cards with role labels", () => {
    const html = render("instagram");
    expect(html).toContain("카드뉴스 10장");
    expect(html).toContain("표지 1 + 핵심 7 + 주의 · 팁 1 + 요약 · CTA 1");
    expect(html).toContain("01 / 10");
    expect(html).toContain("10 / 10");
    // 해시태그 개수는 원문 태그에 따라 달라집니다(스키마 하한 15~상한 20).
    expect(html).toMatch(/해시태그 \d+개/);
  });

  it("renders the ~20-line facebook feed with bullets and question", () => {
    const html = render("facebook");
    expect(html).toContain("약 20줄 피드");
    expect(html).toContain("핵심 불릿 5개");
    expect(html).toContain("여러분은 어떻게 적용하고 계신가요?");
  });
});
