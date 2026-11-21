import { describe, expect, it } from "vitest";

import { aspectPreset } from "../src/aspect";
import { buildDemoStoryboard } from "../src/demo/storyboard";
import {
  alignCueTimings,
  buildAss,
  buildSrt,
  cuesFromStoryboard,
  formatAssTime,
  formatSrtTime,
  splitNarrationIntoChunks,
  subtitleSet,
  wrapText,
} from "../src/subtitles";

const preset = aspectPreset("9:16");

describe("subtitle formatting", () => {
  it("formats SRT and ASS timestamps", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(61_250)).toBe("00:01:01,250");
    expect(formatSrtTime(3_661_004)).toBe("01:01:01,004");
    expect(formatAssTime(61_250)).toBe("0:01:01.25");
    expect(formatAssTime(3_661_004)).toBe("1:01:01.00");
  });

  it("writes a numbered SRT block per cue", () => {
    const srt = buildSrt([
      { startMs: 0, endMs: 1_200, text: "첫 번째 자막" },
      { startMs: 1_300, endMs: 2_500, text: "두 번째 자막" },
    ]);

    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,200\n첫 번째 자막\n\n2\n00:00:01,300 --> 00:00:02,500\n두 번째 자막\n",
    );
  });

  it("writes a playable ASS header with the aspect resolution", () => {
    const ass = buildAss([{ startMs: 0, endMs: 2_000, text: "안녕하세요 여러분" }], { preset, title: "테스트" });

    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("Style: Default");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Default");
    expect(ass).toContain("안녕하세요 여러분");
  });

  it("wraps long cues into at most two lines without dropping words", () => {
    const source = "이 문장은 자막 한 줄에 담기에는 너무 길어서 두 줄로 나눠야 합니다";
    const lines = wrapText(source, 12, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.join(" ")).toBe(source);
    expect(lines[0]?.length).toBeLessThanOrEqual(12);

    const ass = buildAss([{ startMs: 0, endMs: 2_000, text: "이 문장은 자막 한 줄에 담기에는 너무 길어서 두 줄로 나눠야 합니다" }], {
      preset,
    });
    expect(ass).toContain("\\N");
  });
});

describe("narration → cues", () => {
  it("splits narration at sentences and keeps every chunk under the limit", () => {
    const text =
      "첫 번째 문장입니다. 두 번째 문장은 조금 더 깁니다. 세 번째 문장은 자막 한 컷에 들어가기 어려울 만큼 길어서 쉼표에서 나뉘어야 합니다, 그리고 계속 이어집니다.";
    const chunks = splitNarrationIntoChunks(text, 22);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(22);
    expect(chunks.join(" ")).toContain("첫 번째 문장입니다");
  });

  it("aligns cues inside the scene window without overlap", () => {
    const cues = alignCueTimings(["하나", "둘", "셋"], 10_000, 6_000);
    expect(cues[0]?.startMs).toBe(10_000);
    expect(cues[cues.length - 1]?.endMs).toBeLessThanOrEqual(16_000 + 1);
    for (let index = 1; index < cues.length; index += 1) {
      expect(cues[index]?.startMs).toBeGreaterThanOrEqual(cues[index - 1]?.endMs ?? 0);
    }
  });

  it("builds preliminary cues from a storyboard", () => {
    const source = {
      sourceType: "blog" as const,
      title: "콘텐츠 세 번 쓰기",
      author: "운영 노트",
      language: "ko",
      text: "첫 번째 단계는 원문을 만드는 것입니다. 두 번째 단계는 주장을 하나만 고르는 것입니다. 세 번째 단계는 형식을 바꾸는 것입니다.",
    };
    const storyboard = buildDemoStoryboard(source, { aspectRatio: "16:9", language: "ko" });
    const cues = cuesFromStoryboard(storyboard, aspectPreset("16:9"));

    expect(cues.length).toBeGreaterThanOrEqual(storyboard.scenes.length);
    expect(cues[0]?.startMs).toBe(0);
    expect(cues[cues.length - 1]?.endMs).toBeLessThanOrEqual(storyboard.totalDurationMs);

    const set = subtitleSet(cues, aspectPreset("16:9"), { source: "aligned", provider: "fallback" });
    expect(set.srt.split("\n\n").length).toBe(cues.length);
    expect(set.ass).toContain("Dialogue:");
  });
});
