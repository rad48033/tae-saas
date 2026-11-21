import { describe, expect, it } from "vitest";

import { aspectPreset } from "../src/aspect";
import { buildDemoStoryboard } from "../src/demo/storyboard";
import type { SourceDocument } from "@tae/ai";

const source: SourceDocument = {
  sourceType: "blog",
  title: "콘텐츠를 세 번 쓰는 법",
  author: "운영 노트",
  url: "https://example.com/reuse",
  language: "ko",
  text: [
    "콘텐츠를 만드는 사람들이 가장 자주 하는 실수는 채널마다 처음부터 새로 쓰는 것입니다.",
    "하나의 주제를 정하고 세 가지 형식으로 다시 쓰면 같은 준비 시간으로 세 배의 노출을 얻습니다.",
    "첫 단계는 원문을 하나 만드는 것입니다. 여기서 말하는 원문은 가장 길고 구체적인 형태입니다.",
    "말로 설명할 때는 사례와 숫자가 더 많이 나옵니다. 녹음 파일을 자막으로 바꿔 두면 그 자체가 원문이 됩니다.",
    "두 번째 단계는 원문에서 주장을 하나만 고르는 것입니다. 모든 이야기를 다시 쓰려고 하면 결과물이 요약문처럼 밋밋해집니다.",
    "세 번째 단계는 형식을 바꾸는 것입니다. 블로그는 문단으로, 카드뉴스는 한 장에 하나의 주장만 담습니다.",
    "쇼츠는 첫 3초에 결론을 던지고 45초 안에 이유를 하나만 붙입니다.",
    "가장 흔한 실수는 형식만 바꾸고 문장을 그대로 옮기는 것입니다.",
    "재활용의 효과를 판단할 때는 조회수 하나만 보지 마세요. 채널별로 저장, 검색 유입, 시청 지속 시간을 함께 봅니다.",
    "준비 시간을 줄이려면 원문을 만들 때부터 장면을 의식하고 말하세요.",
    "한계도 분명합니다. 이미 주제가 정해진 사람에게 잘 맞고, 한 주에 원문 하나에 결과물 두세 개가 현실적인 상한입니다.",
    "정리하면 원문은 길고 구체적으로, 주장은 하나만, 형식마다 문장은 새로 쓰고, 성과는 채널별 지표로 비교하세요.",
  ].join(" "),
};

describe("demo storyboard", () => {
  for (const aspectRatio of ["9:16", "16:9"] as const) {
    it(`builds a ${aspectRatio} storyboard inside the product spec`, () => {
      const preset = aspectPreset(aspectRatio);
      const storyboard = buildDemoStoryboard(source, { aspectRatio, language: "ko" });

      expect(storyboard.aspectRatio).toBe(aspectRatio);
      expect(storyboard.width).toBe(preset.width);
      expect(storyboard.height).toBe(preset.height);
      expect(storyboard.scenes.length).toBeGreaterThanOrEqual(preset.scenes.min);
      expect(storyboard.scenes.length).toBeLessThanOrEqual(preset.scenes.max);

      const seconds = storyboard.totalDurationMs / 1000;
      expect(seconds).toBeGreaterThanOrEqual(preset.durationSeconds.min);
      expect(seconds).toBeLessThanOrEqual(preset.durationSeconds.max);

      // 장면 타이밍은 빈틈없이 이어지고, 마지막 장면이 총 길이와 일치합니다.
      let cursor = 0;
      for (const [index, scene] of storyboard.scenes.entries()) {
        expect(scene.index).toBe(index + 1);
        expect(scene.startMs).toBe(cursor);
        expect(scene.endMs).toBe(scene.startMs + scene.durationMs);
        expect(scene.narration.length).toBeGreaterThan(20);
        expect(scene.visualPrompt).toMatch(/no text/i);
        cursor = scene.endMs;
      }
      expect(cursor).toBe(storyboard.totalDurationMs);

      expect(storyboard.hashtags.every((tag) => tag.startsWith("#"))).toBe(true);
      expect(storyboard.hook.length).toBeGreaterThan(10);
    });
  }

  it("writes English narration and prompts for an English source", () => {
    const storyboard = buildDemoStoryboard(
      {
        ...source,
        language: "en",
        title: "How to reuse one piece of content three times",
        text: "Most creators write every channel from scratch. Pick one topic and rewrite it for three formats. Start with the longest source, then choose one claim, then change the format for each channel. Compare saves, search traffic and watch time instead of views alone.",
      },
      { aspectRatio: "9:16", language: "en" },
    );

    expect(storyboard.language).toBe("en");
    expect(storyboard.scenes[0]?.narration).toContain("Today");
    expect(storyboard.description.length).toBeGreaterThan(10);
  });

  it("keeps timings stable for the same source (deterministic)", () => {
    const first = buildDemoStoryboard(source, { aspectRatio: "16:9", language: "ko" });
    const second = buildDemoStoryboard(source, { aspectRatio: "16:9", language: "ko" });
    expect(second.scenes.map((scene) => scene.durationMs)).toEqual(first.scenes.map((scene) => scene.durationMs));
    expect(second.scenes.map((scene) => scene.narration)).toEqual(first.scenes.map((scene) => scene.narration));
  });
});
