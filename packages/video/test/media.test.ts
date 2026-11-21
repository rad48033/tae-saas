import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { aspectPreset } from "../src/aspect";
import { DemoTtsProvider, planUnits, renderSpeechCadence } from "../src/audio/demo";
import { encodeWav, readWavInfo } from "../src/audio/wav";
import { DemoImageProvider } from "../src/images/demo";
import { encodePng } from "../src/images/png";
import type { StoryboardScene } from "../src/types";

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "tae-video-media-"));
});

afterAll(async () => {
  // OS tmp 정리(실패해도 테스트 결과에는 영향 없음)
  const { rm } = await import("node:fs/promises");
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

function scene(index: number): StoryboardScene {
  return {
    index,
    title: "첫 번째 장면",
    narration: "콘텐츠는 한 번 만들고 세 번 씁니다.",
    visualPrompt: "a sunlit desk with a notebook. No text.",
    startMs: 0,
    endMs: 6_000,
    durationMs: 6_000,
  };
}

describe("PNG encoder / demo image", () => {
  it("encodes a real PNG with the requested dimensions", async () => {
    const width = 32;
    const height = 48;
    const rgb = new Uint8Array(width * height * 3).fill(128);
    const png = encodePng(width, height, rgb);

    expect(png.toString("ascii", 1, 4)).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
    expect(png.toString("ascii", 37, 41)).toBe("IDAT");
  });

  it("writes a scene image and its prompt sidecar", async () => {
    const preset = aspectPreset("9:16");
    const provider = new DemoImageProvider();
    const outPath = path.join(workDir, "images", "scene-01.png");

    const result = await provider.generate({
      scene: scene(1),
      aspectRatio: "9:16",
      width: preset.width,
      height: preset.height,
      style: "cinematic",
      outPath,
    });

    expect(result.provider).toBe("demo");
    const info = await stat(outPath);
    expect(info.size).toBeGreaterThan(10_000);
    const promptText = await readFile(`${outPath}.prompt.txt`, "utf8");
    expect(promptText).toContain("sunlit desk");
  });
});

describe("WAV / demo TTS", () => {
  it("encodes a 16-bit PCM WAV with the exact duration", () => {
    const sampleRate = 24_000;
    const samples = new Float32Array(sampleRate); // 1초
    samples.fill(0.25);
    const wav = encodeWav(samples, sampleRate);

    const info = readWavInfo(wav);
    expect(info).not.toBeNull();
    expect(info?.sampleRate).toBe(sampleRate);
    expect(info?.channels).toBe(1);
    expect(info?.bitsPerSample).toBe(16);
    expect(info?.durationMs).toBe(1_000);
  });

  it("plans speech units by syllables, pauses and sentence ends", () => {
    const units = planUnits("안녕하세요. 오늘은 콘텐츠 이야기입니다.", 4_000, "ko");
    expect(units.filter((unit) => unit.voiced).length).toBeGreaterThan(10);
    expect(units.some((unit) => unit.terminal)).toBe(true);
    const total = units.reduce((sum, unit) => sum + unit.seconds, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("renders audible, deterministic speech cadence", () => {
    const first = renderSpeechCadence("안녕하세요. 오늘은 콘텐츠 이야기입니다.", 4_000, 1, "ko");
    const second = renderSpeechCadence("안녕하세요. 오늘은 콘텐츠 이야기입니다.", 4_000, 1, "ko");

    expect(first.length).toBe(24_000 * 4);
    expect(Math.max(...first.slice(0, 24_000))).toBeGreaterThan(0.05);
    expect(Array.from(first.slice(0, 500))).toEqual(Array.from(second.slice(0, 500)));
  });

  it("writes a WAV matching the storyboard duration", async () => {
    const provider = new DemoTtsProvider();
    const outPath = path.join(workDir, "audio", "scene-01.wav");
    const result = await provider.synthesize({
      text: "콘텐츠는 한 번 만들고 세 번 씁니다. 먼저 원문을 길게 남기세요.",
      language: "ko",
      voice: "alloy",
      targetDurationMs: 7_500,
      outPath,
      sceneIndex: 1,
    });

    expect(result.durationMs).toBe(7_500);
    const bytes = await readFile(outPath);
    expect(readWavInfo(bytes)?.durationMs).toBe(7_500);
  });
});
