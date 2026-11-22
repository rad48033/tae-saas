import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildDemoStoryboard } from "@tae/video";

import { VideoResultView } from "../src/components/video-result-view";
import type { ConvertResult } from "../src/lib/api-types";

const source = {
  sourceType: "blog" as const,
  title: "콘텐츠를 세 번 쓰는 법",
  author: "운영 노트",
  language: "ko",
  text: "콘텐츠를 만드는 사람들이 가장 자주 하는 실수는 채널마다 처음부터 새로 쓰는 것입니다. 첫 단계는 원문을 하나 만드는 것입니다. 두 번째 단계는 주장을 하나만 고르는 것입니다. 세 번째 단계는 형식을 바꾸는 것입니다.",
};

function renderPackage(renderAvailable: boolean): string {
  const storyboard = buildDemoStoryboard(source, { aspectRatio: "9:16", language: "ko" });

  const result: ConvertResult = {
    jobId: "job_video",
    format: "youtube_video",
    draft: null,
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
        totalSeconds: Math.round(storyboard.totalDurationMs / 1000),
      },
      storyboard,
      subtitles: {
        srt: "1\n00:00:00,000 --> 00:00:02,000\n첫 자막\n",
        ass: "[Script Info]\nPlayResX: 1080\n",
        cueCount: 12,
        source: "aligned",
      },
      render: renderAvailable
        ? { available: true, mode: "worker", reason: null }
        : { available: false, mode: "disabled", reason: "워커가 없습니다." },
    },
    credits: { remaining: 1, charged: 1 },
    meta: {
      provider: "demo",
      model: "demo-storyboard",
      mode: "demo",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 900,
      warnings: [],
    },
  };

  return renderToStaticMarkup(<VideoResultView result={result} />);
}

describe("VideoResultView", () => {
  it("renders every scene with timecodes, narration and subtitle download actions", () => {
    const html = renderPackage(true);

    expect(html).toContain("유튜브 영상 · 9:16 쇼츠");
    expect(html).toContain("1080×1920");
    expect(html).toContain("스토리보드");
    expect(html).toContain("SRT 저장");
    expect(html).toContain("ASS 저장");
    expect(html).toContain("나레이션 복사");
    expect(html).toContain("MP4 렌더 시작");
    expect(html).toContain("이미지 프롬프트 보기");
    expect(html).toContain("00:00");
    expect(html).toContain("대본");
  });

  it("explains the disabled render mode instead of showing a dead button", () => {
    const html = renderPackage(false);
    expect(html).toContain("워커가 없습니다.");
    expect(html).not.toContain("MP4 렌더 시작");
  });
});
