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

  it("removes hashtags, mentions and emoji from narration so TTS does not read them", () => {
    const storyboard = buildDemoStoryboard(
      {
        ...source,
        sourceType: "instagram",
        title: "을뜨뜨 악토프리미엄, 온가족 유산균",
        text: [
          "#협찬 #을뜨뜨서포터즈 | 악토프리미엄",
          "요즘 우리가족 장 건강을 위해 챙겨먹기 시작한 을뜨뜨 악토프리미엄🩵 새콤달콤한 요구르트맛이라 아이도 거부감 없이 맛있게 먹고 있어요☺️",
          "유산균에 비타민D와 아연까지 한 번에! 하루 권장 섭취량 100%를 충족해 아이에게 필요한 영양을 간편하게 챙길 수 있더라구요👍🏻",
          "🏷️ @petitn_official #을뜨뜨악토프리미엄 #온가족유산균 #아기유산균",
        ].join("\n"),
      },
      { aspectRatio: "9:16", language: "ko" },
    );

    const narration = storyboard.scenes.map((scene) => scene.narration).join(" ");
    expect(narration).not.toContain("#");
    expect(narration).not.toContain("@");
    expect(narration).not.toMatch(/[🩵☺️👍🏻🏷️]/u);
    expect(storyboard.hashtags.every((tag) => !tag.includes(","))).toBe(true);
    // 숫자·퍼센트는 자막에서 사라지지 않습니다.
    expect(narration).toContain("100%");
  });

  it("picks theme-aware visual motifs from the source text", () => {
    const food = buildDemoStoryboard(
      { ...source, title: "아기 유산균 추천", text: "" },
      { aspectRatio: "9:16", language: "ko" },
    );
    const prompts = food.scenes.map((scene) => scene.visualPrompt).join(" ");
    expect(prompts).toMatch(/yogurt|milk|kitchen|breakfast|dairy/i);
  });
});

describe("generateStoryboard with a live provider", () => {
  it("reports the provider that actually answered", async () => {
    const { generateStoryboard } = await import("../src/storyboard");
    const draft = {
      title: "콘텐츠를 세 번 쓰는 법",
      hook: "한 번 만들고 세 번 쓰는 방법이 있습니다.",
      description: "원문 하나로 블로그·카드뉴스·쇼츠를 만드는 순서를 정리합니다.",
      style: "깔끔한 한국어 설명 영상, 밝은 자연광, 실제 사물 사진",
      scenes: [1, 2, 3, 4].map((index) => ({
        title: `장면 ${index}`,
        narration: `장면 ${index}의 나레이션입니다. 원문의 내용을 말하듯 자연스럽게 전합니다.`,
        visualPrompt: `Scene ${index}: a person writing notes at a clean wooden desk, natural light, no text`,
      })),
      hashtags: ["콘텐츠재활용"],
    };

    const provider = {
      id: "gemini" as const,
      model: "gemini-3.8-flash",
      complete: async () => ({
        text: JSON.stringify(draft),
        usage: { inputTokens: 100, outputTokens: 200 },
        model: "gemini-3.8-flash",
        provider: "gemini" as const,
        stopReason: "STOP",
      }),
    };

    const result = await generateStoryboard(source, { aspectRatio: "9:16", language: "ko", provider });

    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-3.8-flash");
    expect(result.storyboard.scenes.length).toBeGreaterThanOrEqual(4);
    expect(result.storyboard.totalDurationMs).toBeGreaterThan(0);
  });
});
