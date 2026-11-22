import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PollinationsImageProvider } from "../src/images/pollinations";
import { createVideoProviders } from "../src/providers";
import { buildDemoStoryboard } from "../src/demo/storyboard";
import type { SourceDocument } from "@tae/ai";

const source: SourceDocument = {
  sourceType: "instagram",
  title: "아기 유산균, 온가족이 함께",
  author: "@family.daily",
  language: "ko",
  text: "아이도 거부감 없이 먹는 요구르트맛 유산균입니다. 하루 한 포로 장 건강을 챙기고 있어요.",
};

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "tae-video-providers-"));
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("provider selection", () => {
  it("uses key-free image and voice providers when OPENAI_API_KEY is absent", () => {
    const set = createVideoProviders({ env: {} });

    expect(set.mode).toBe("demo");
    expect(set.image.id).toBe("pollinations");
    expect(set.tts.id).toBe("google");
    // 대체가 실패하면 카드 이미지·배경 음으로 넘어갈 수 있어야 합니다.
    expect(set.imageFallback?.id).toBe("demo");
    expect(set.ttsFallback?.id).toBe("demo");
    expect(set.warnings.join(" ")).toContain("OPENAI_API_KEY");
    expect(set.warnings.join(" ")).toContain("Pollinations");
  });

  it("never calls external services when VIDEO_OFFLINE=1", () => {
    const set = createVideoProviders({ env: { VIDEO_OFFLINE: "1" } });
    expect(set.image.id).toBe("demo");
    expect(set.tts.id).toBe("demo");
    expect(set.imageFallback).toBeNull();
    expect(set.ttsFallback).toBeNull();
  });

  it("honours VIDEO_DEMO_IMAGE=card and VIDEO_DEMO_VOICE=bed", () => {
    const set = createVideoProviders({ env: { VIDEO_DEMO_IMAGE: "card", VIDEO_DEMO_VOICE: "bed" } });
    expect(set.image.id).toBe("demo");
    expect(set.tts.id).toBe("demo");
  });

  it("keeps the real OpenAI path untouched when a key is provided", () => {
    const set = createVideoProviders({ env: { OPENAI_API_KEY: "sk-test" } });
    expect(set.image.id).toBe("openai");
    expect(set.tts.id).toBe("openai");
    expect(set.imageFallback).toBeNull();
    expect(set.ttsFallback).toBeNull();
  });
});

describe("pollinations fallback", () => {
  it("falls back to a card image when the free endpoint is unreachable", async () => {
    const storyboard = buildDemoStoryboard(source, { aspectRatio: "9:16", language: "ko" });
    const scene = storyboard.scenes[0]!;

    const provider = new PollinationsImageProvider({
      baseUrl: "http://127.0.0.1:9/prompt",
      minIntervalMs: 0,
      timeoutMs: 3_000,
      cacheDir: path.join(workDir, "cache"),
    });

    const image = await provider.generate({
      scene,
      aspectRatio: "9:16",
      width: 320,
      height: 568,
      style: storyboard.style,
      outPath: path.join(workDir, "images", "scene-01.png"),
    });

    expect(image.provider).toBe("demo");
    expect(image.path.endsWith(".png")).toBe(true);
  });
});
