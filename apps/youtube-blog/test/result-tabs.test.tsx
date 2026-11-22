import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildDemoContent, type ContentDraft } from "@tae/ai";
import { buildDemoStoryboard } from "@tae/video";

import type { ConvertRequestPayload, ConvertResult, CreditCosts } from "../src/lib/api-types";
import { ResultTabs } from "../src/components/result-tabs";

const COSTS: CreditCosts = {
  text: 1,
  textSet: 1,
  videoStoryboard: 3,
  videoRender: 6,
  videoPreview: 1,
  videoTotal: 9,
  pdfPagesPerCredit: 10,
  trial: 10,
};

const source = {
  sourceType: "blog" as const,
  title: "콘텐츠를 세 번 쓰는 법",
  author: "운영 노트",
  language: "ko" as const,
  text: "콘텐츠를 만드는 사람들이 가장 자주 하는 실수는 채널마다 처음부터 새로 쓰는 것입니다. 원문을 하나 만들고 형식만 바꾸면 같은 노력으로 네 채널을 채울 수 있습니다.",
};

const request: ConvertRequestPayload = { sourceType: "blog", language: "ko", format: "blog" };

const noop = async () => true;

function baseResult(overrides: Partial<ConvertResult>): ConvertResult {
  return {
    jobId: "job-1",
    format: "blog",
    source: {
      sourceType: "blog",
      title: source.title,
      author: source.author,
      url: null,
      thumbnailUrl: null,
      textChars: source.text.length,
      textSource: "pasted",
      warnings: [],
    },
    draft: null,
    video: null,
    credits: { remaining: 7, charged: 1 },
    meta: {
      provider: "demo",
      model: "demo-heuristic",
      mode: "demo",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 900,
    },
    ...overrides,
  };
}

function render(result: ConvertResult): string {
  return renderToStaticMarkup(
    <ResultTabs
      result={result}
      request={request}
      costs={COSTS}
      credits={7}
      busy={false}
      videoMode="worker"
      onGenerate={noop}
      onCredits={() => undefined}
      onNavigate={() => undefined}
    />,
  );
}

describe("ResultTabs", () => {
  it("영상·블로그·인스타 10장·페이스북 20줄 네 탭을 모두 보여 준다", () => {
    const draft = buildDemoContent({ source, target: { language: "ko", format: "blog" } }) as ContentDraft;
    const html = render(baseResult({ draft, drafts: { blog: draft } }));

    expect(html).toContain("영상");
    expect(html).toContain("블로그");
    expect(html).toContain("인스타 10장");
    expect(html).toContain("페이스북 20줄");
    expect(html).toContain("완성");
    expect(html).toContain("한눈에 보는 요약");
  });

  it("만들지 않은 탭은 크레딧 단가와 만들기 버튼을 보여 준다", () => {
    const draft = buildDemoContent({ source, target: { language: "ko", format: "blog" } }) as ContentDraft;
    const html = render(baseResult({ draft, drafts: { blog: draft } }));
    expect(html).toContain("3크레딧");
    expect(html).toContain("1크레딧");
  });

  it("영상 결과가 있으면 플레이어 자리와 렌더·자막 버튼을 그린다", () => {
    const storyboard = buildDemoStoryboard(
      { sourceType: "blog", title: source.title, author: source.author, language: "ko", text: source.text },
      { aspectRatio: "9:16", language: "ko" },
    );
    const html = render(
      baseResult({
        format: "youtube_video",
        video: {
          aspectRatio: "9:16",
          preset: {
            id: "9:16",
            label: "9:16 쇼츠",
            width: 1080,
            height: 1920,
            sceneMin: 5,
            sceneMax: 8,
            durationMin: 45,
            durationMax: 60,
            totalSeconds: 48,
          },
          storyboard,
          subtitles: { srt: "1\n00:00:00,000 --> 00:00:02,000\n첫 자막\n", ass: "[Script Info]", cueCount: 3, source: "aligned" },
          render: { available: true, mode: "worker", reason: null },
        },
        credits: { remaining: 4, charged: 3 },
      }),
    );

    expect(html).toContain("MP4 렌더 시작");
    expect(html).toContain("SRT 저장");
    expect(html).toContain("ASS 저장");
    expect(html).toContain("MP4 렌더 6크레딧");
  });
});
