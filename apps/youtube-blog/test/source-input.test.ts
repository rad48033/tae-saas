import { describe, expect, it } from "vitest";

import { buildDemoStoryboard } from "@tae/video";
import type { Storyboard } from "@tae/video";

import { AppError } from "../src/lib/app-error";
import { resolveSource } from "../src/lib/source-input";
import { buildVideoPackage } from "../src/lib/video";

const LONG_ARTICLE = `콘텐츠를 만드는 사람들이 가장 자주 하는 실수는 채널마다 처음부터 새로 쓰는 것입니다.
하나의 주제를 정하고 세 가지 형식으로 다시 쓰면 같은 준비 시간으로 세 배의 노출을 얻습니다.
첫 단계는 원문을 하나 만드는 것입니다. 가장 길고 구체적인 형태로 남겨야 합니다.
두 번째 단계는 원문에서 주장을 하나만 고르는 것입니다.
세 번째 단계는 형식을 바꾸는 것입니다. 블로그는 문단, 카드뉴스는 한 장에 하나의 주장입니다.
쇼츠는 첫 3초에 결론을 던지고 45초 안에 이유를 하나만 붙입니다.
준비 시간을 줄이려면 원문을 만들 때부터 장면을 의식하고 말하세요.
재활용의 효과는 조회수 하나가 아니라 채널별 저장·검색 유입·시청 지속 시간으로 비교합니다.
한 주에 원문 하나, 결과물 두세 개가 현실적인 상한입니다. 오늘 바로 첫 문장을 적어 보세요.`;

describe("resolveSource", () => {
  it("accepts a pasted blog article without a URL", async () => {
    const resolved = await resolveSource({
      sourceType: "blog",
      text: LONG_ARTICLE,
      title: "콘텐츠 세 번 쓰기",
      author: "운영 노트",
      language: "ko",
    });

    expect(resolved.source.sourceType).toBe("blog");
    expect(resolved.source.title).toBe("콘텐츠 세 번 쓰기");
    expect(resolved.source.text.length).toBeGreaterThan(200);
    expect(resolved.meta.textSource).toBe("pasted");
  });

  it("accepts a pasted Instagram caption", async () => {
    const resolved = await resolveSource({
      sourceType: "instagram",
      text: "카드뉴스 열 장을 만들었다면 그중 한 장만 골라 쇼츠로 바꿔 보세요. 첫 3초에 결론을 던지고 45초 안에 이유를 하나만 붙입니다. 같은 내용을 반복하지 말고 순서를 바꾸세요.",
      language: "ko",
    });

    expect(resolved.source.sourceType).toBe("instagram");
    expect(resolved.source.author).toBe("인스타그램");
  });

  it("accepts a pasted transcript for YouTube", async () => {
    const resolved = await resolveSource({
      sourceType: "youtube",
      transcript: LONG_ARTICLE.repeat(3),
      title: "직접 붙여넣은 자막",
      language: "ko",
    });

    expect(resolved.source.sourceType).toBe("youtube");
    expect(resolved.meta.textSource).toBe("transcript");
    expect(resolved.source.text.length).toBeGreaterThan(200);
  });

  it("rejects an empty request with a helpful message", async () => {
    await expect(resolveSource({ sourceType: "blog", language: "ko" })).rejects.toBeInstanceOf(AppError);
    await expect(resolveSource({ sourceType: "instagram", language: "ko" })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("refuses private network URLs", async () => {
    await expect(
      resolveSource({ sourceType: "blog", url: "http://127.0.0.1:8080/admin", language: "ko" }),
    ).rejects.toMatchObject({ code: "invalid_url" });
  });
});

describe("buildVideoPackage", () => {
  const source = {
    sourceType: "blog" as const,
    title: "콘텐츠 세 번 쓰기",
    author: "운영 노트",
    language: "ko",
    text: LONG_ARTICLE,
  };

  it("attaches preset, subtitles and render availability", () => {
    const storyboard: Storyboard = buildDemoStoryboard(source, { aspectRatio: "9:16", language: "ko" });
    const pkg = buildVideoPackage(storyboard, { mode: "worker", workerUrl: "http://worker", token: null, outputDir: "/tmp" });

    expect(pkg.aspectRatio).toBe("9:16");
    expect(pkg.preset.width).toBe(1080);
    expect(pkg.preset.sceneMin).toBe(6);
    expect(pkg.subtitles.srt).toContain("-->");
    expect(pkg.subtitles.ass).toContain("PlayResY: 1920");
    expect(pkg.subtitles.cueCount).toBeGreaterThan(0);
    expect(pkg.render.available).toBe(true);
    expect(pkg.render.mode).toBe("worker");
  });

  it("explains why rendering is unavailable instead of failing", () => {
    const storyboard = buildDemoStoryboard(source, { aspectRatio: "16:9", language: "ko" });
    const pkg = buildVideoPackage(storyboard, { mode: "disabled", workerUrl: null, token: null, outputDir: "/tmp" });

    expect(pkg.render.available).toBe(false);
    expect(pkg.render.reason).toContain("video-worker");
  });

  it("publishes the reference photos taken from the storyboard", () => {
    const storyboard: Storyboard = buildDemoStoryboard(source, {
      aspectRatio: "9:16",
      language: "ko",
      referenceImages: [{ url: "https://cdn.example.com/box.jpg", label: "제품 박스 정면", role: "product" }],
    });
    const pkg = buildVideoPackage(storyboard, { mode: "worker", workerUrl: "http://worker", token: null, outputDir: "/tmp" });

    expect(pkg.references).toEqual({ count: 1, labels: ["제품 박스 정면"] });
    expect(pkg.storyboard.references?.[0]?.url).toBe("https://cdn.example.com/box.jpg");
  });
});
