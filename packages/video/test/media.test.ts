import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { aspectPreset } from "../src/aspect";
import { DemoTtsProvider, renderAmbientBed } from "../src/audio/demo";
import { concatMp3, mp3DurationMs, readMp3Info } from "../src/audio/mp3";
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

describe("WAV / demo voice fallback", () => {
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

  it("renders a deterministic ambient bed with the exact length", () => {
    const first = renderAmbientBed({ text: "안녕하세요. 오늘은 콘텐츠 이야기입니다.", durationMs: 4_000, sceneIndex: 1, language: "ko" });
    const second = renderAmbientBed({ text: "안녕하세요. 오늘은 콘텐츠 이야기입니다.", durationMs: 4_000, sceneIndex: 1, language: "ko" });

    expect(first.length).toBe(24_000 * 4);
    expect(Array.from(first.slice(0, 500))).toEqual(Array.from(second.slice(0, 500)));
  });

  it("stays audible but never clips or drifts like a siren", () => {
    const samples = renderAmbientBed({
      text: "첫 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다.",
      durationMs: 12_000,
      sceneIndex: 3,
      language: "ko",
    });

    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(0.5);
    expect(samples.every((value) => Number.isFinite(value))).toBe(true);

    // 예전 재생기 버그: 위상이 절대 시간에 비례해 장면 뒤쪽에서 음이 미쳐 날뛰었습니다.
    // 지금은 저음 패드라 영역별 제로크로싱 비율이 크게 변하지 않아야 합니다.
    const rateOf = (from: number, to: number) => {
      let crossings = 0;
      for (let index = from + 1; index < to; index += 1) {
        if (Math.sign(samples[index] ?? 0) !== Math.sign(samples[index - 1] ?? 0)) crossings += 1;
      }
      return crossings / ((to - from) / 24_000);
    };
    const early = rateOf(24_000, 72_000);
    const late = rateOf(24_000 * 9, 24_000 * 11);
    expect(Math.abs(early - late) / Math.max(early, late)).toBeLessThan(0.6);
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
    expect(result.provider).toBe("demo");
    const bytes = await readFile(outPath);
    expect(readWavInfo(bytes)?.durationMs).toBe(7_500);
  });
});

describe("MP3 duration parser (키 없는 TTS 길이 측정)", () => {
  /** 24kHz · 64kbps · 모노 MPEG2 Layer III 프레임 */
  function frame(samples: number, sampleRate = 24_000, bitrateKbps = 64): Buffer {
    const length = Math.floor((samples / 8) * ((bitrateKbps * 1_000) / sampleRate));
    const buffer = Buffer.alloc(length, 0);
    buffer[0] = 0xff;
    buffer[1] = 0xf3; // MPEG2, Layer III
    buffer[2] = 0x44; // bitrate index 4(64k), 24kHz
    buffer[3] = 0xc0; // mono
    return buffer;
  }

  it("counts frames and converts them to milliseconds", () => {
    const mp3 = Buffer.concat(Array.from({ length: 50 }, () => frame(576)));
    const info = readMp3Info(mp3);
    expect(info?.sampleRate).toBe(24_000);
    expect(info?.frames).toBe(50);
    expect(info?.durationMs).toBe(Math.round((50 * 576 * 1_000) / 24_000));
    expect(mp3DurationMs(mp3)).toBe(info?.durationMs);
  });

  it("skips ID3 headers and keeps the audio bytes when concatenating", () => {
    const id3 = Buffer.concat([Buffer.from("ID3", "ascii"), Buffer.from([4, 0, 0, 0, 0, 0, 10]), Buffer.alloc(10)]);
    const first = Buffer.concat([id3, frame(576)]);
    const second = frame(576);
    const joined = concatMp3([first, second]);

    expect(joined.length).toBe(joined.length);
    expect(readMp3Info(joined)?.frames).toBe(2);
    expect(joined.subarray(0, 1).toString("hex")).toBe("ff");
  });
});
