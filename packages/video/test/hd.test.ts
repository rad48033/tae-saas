import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { aspectPreset } from "../src/aspect";
import { OpenAITtsProvider, normalizeSpeed } from "../src/audio/openai";
import { encodeWav } from "../src/audio/wav";
import { imageSizeFor } from "../src/images/openai";
import { buildDemoStoryboard } from "../src/demo/storyboard";
import { createVideoProviders } from "../src/providers";
import { buildAss } from "../src/subtitles";
import { buildFfmpegPlan } from "../src/renderer/ffmpeg";
import { cuesFromScript, cuesFromWords, normalizeCues } from "../src/stt/openai";
import type { RenderRequest } from "../src/types";
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
  workDir = await mkdtemp(path.join(tmpdir(), "tae-video-hd-"));
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("OpenAI PNG size per model", () => {
  it("generates native 16-multiple sizes for gpt-image-2", () => {
    expect(imageSizeFor("gpt-image-2", "9:16")).toBe("1088x1920");
    expect(imageSizeFor("gpt-image-2", "16:9")).toBe("1920x1088");
  });

  it("keeps the older image models on their supported sizes", () => {
    expect(imageSizeFor("gpt-image-1-mini", "9:16")).toBe("1024x1536");
    expect(imageSizeFor("dall-e-3", "9:16")).toBe("1024x1792");
  });
});

describe("reel defaults (OpenAI TTS)", () => {
  it("defaults to gpt-4o-mini-tts · alloy · 1.25x", () => {
    const set = createVideoProviders({
      env: { OPENAI_API_KEY: "sk-test", AI_PROVIDER: "gemini", GEMINI_API_KEY: "gm-key", VIDEO_PROVIDER: "openai" },
    });

    expect(set.image.id).toBe("openai");
    expect(set.image.model).toBe("gpt-image-2");
    expect(set.imageFallback?.model).toBe("gpt-image-1-mini");
    expect(set.tts.id).toBe("openai");
    expect(set.tts.model).toBe("gpt-4o-mini-tts");
    expect((set.tts as OpenAITtsProvider).voice).toBe("alloy");
    expect((set.tts as OpenAITtsProvider).speed).toBe(1.25);
    // 자막은 단어 타임스탬프가 있는 whisper-1이 기본입니다.
    expect(set.stt.model).toBe("whisper-1");
    // 대본은 Gemini, 미디어는 OpenAI 하이브리드.
    expect(set.storyboard?.id).toBe("gemini");
  });

  it("honours OPENAI_TTS_SPEED · OPENAI_TTS_VOICE · OPENAI_STT_MODEL", () => {
    const set = createVideoProviders({
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENAI_TTS_SPEED: "1.1",
        OPENAI_TTS_VOICE: "coral",
        OPENAI_STT_MODEL: "gpt-4o-mini-transcribe",
      },
    });
    expect((set.tts as OpenAITtsProvider).speed).toBe(1.1);
    expect((set.tts as OpenAITtsProvider).voice).toBe("coral");
    expect(set.stt.model).toBe("gpt-4o-mini-transcribe");
    expect(set.warnings.join(" ")).toContain("whisper-1");
  });

  it("normalizes speed values OpenAI accepts", () => {
    expect(normalizeSpeed(undefined)).toBeNull();
    expect(normalizeSpeed(1)).toBeNull();
    expect(normalizeSpeed(-2)).toBeNull();
    expect(normalizeSpeed(1.25)).toBe(1.25);
    expect(normalizeSpeed(9)).toBe(4);
  });

  it("sends speed and voice to the speech API", async () => {
    const calls: Record<string, unknown>[] = [];
    const originalFetch = globalThis.fetch;
    const samples = new Float32Array(2_400).fill(0.1);
    const wav = encodeWav(samples, 24_000);

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(new Uint8Array(wav), { status: 200, headers: { "content-type": "audio/wav" } });
    }) as typeof fetch;

    try {
      const provider = new OpenAITtsProvider({ apiKey: "sk-test", speed: 1.25 });
      const result = await provider.synthesize({
        text: "아기 유산균, 딱 세 가지만 기억하세요.",
        language: "ko",
        voice: "alloy",
        targetDurationMs: 4_000,
        outPath: path.join(workDir, "audio", "scene-01.wav"),
        sceneIndex: 1,
      });

      expect(calls[0]).toMatchObject({ model: "gpt-4o-mini-tts", voice: "alloy", speed: 1.25 });
      expect(result.model).toBe("gpt-4o-mini-tts");
      expect(result.durationMs).toBe(100);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("whisper word timestamps → reel cues", () => {
  it("keeps each cue at or under 2.5 seconds and splits on word boundaries", () => {
    // 0.5초 간격으로 이어지는 12개 단어(총 6초) → 2.5초 상한이면 3컷 이상이어야 합니다.
    const words = Array.from({ length: 12 }, (_, index) => ({
      word: `단어${index + 1}`,
      start: index * 0.5,
      end: index * 0.5 + 0.45,
    }));

    const cues = cuesFromWords(words, 10_000, 6, 18, 2_500);

    expect(cues.length).toBeGreaterThanOrEqual(3);
    for (const cue of cues) {
      expect(cue.endMs - cue.startMs).toBeLessThanOrEqual(2_500 + 300);
      expect(cue.text.startsWith("단어")).toBe(true);
    }
    // 시작 시각이 장면 시작(10초)에 더해집니다.
    expect(cues[0]?.startMs).toBe(10_000);
  });
});

describe("script-anchored captions", () => {
  it("keeps the script wording while timing with whisper words", () => {
    const narration = "유산균에 비타민D와 아연까지 들어있어서 하루 권장량을 100% 채워줍니다.";
    // Whisper가 '아연'을 '아이온'으로 잘못 받아쓴 상황을 흉내냅니다.
    const words = narration
      .replace("아연", "아이온")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map((word, index) => ({ word, start: index * 0.42, end: index * 0.42 + 0.36 }));

    const cues = cuesFromScript(narration, words, 0, 5.5, 18, 2_500);
    const joined = cues.map((cue) => cue.text).join(" ");

    expect(joined).toContain("아연");
    expect(joined).not.toContain("아이온");
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) expect(cue.endMs - cue.startMs).toBeLessThanOrEqual(2_750);
  });

  it("splits an over-long cue at a word boundary instead of flashing a one-word caption", () => {
    const cues = normalizeCues(
      [{ startMs: 0, endMs: 4_000, text: "둘째 분유에도 쏙 넣고 첫째 우유에도 한 포씩 넣어 주고 있어요" }],
      6_000,
      2_500,
    );

    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((cue) => cue.text.length > 0)).toBe(true);
    for (const cue of cues) {
      expect(cue.endMs - cue.startMs).toBeLessThanOrEqual(2_750);
      expect(cue.endMs - cue.startMs).toBeGreaterThanOrEqual(700);
    }
  });
});

describe("subtitle readability", () => {
  it("uses a bold, larger caption with a real outline", () => {
    const preset = aspectPreset("9:16");
    const ass = buildAss([{ startMs: 0, endMs: 2_000, text: "온가족이 함께 챙겨 먹는 유산균" }], { preset });
    const style = ass.split("\n").find((line) => line.startsWith("Style: Default")) ?? "";

    expect(style).toContain(`Default,Noto Sans CJK KR,${preset.subtitle.fontSize}`);
    expect(style).toContain(",-1,"); // Bold
    expect(style).toContain(",1,"); // BorderStyle: outline
    expect(style).toContain("&H00000000"); // 검정 외곽선
    expect(preset.subtitle.fontSize).toBeGreaterThanOrEqual(72);
  });

  it("supports a readable background box without changing the default", () => {
    const preset = aspectPreset("9:16");
    const boxed = buildAss([{ startMs: 0, endMs: 1_000, text: "박스 자막" }], {
      preset: { ...preset, subtitle: { ...preset.subtitle, box: true } },
    });
    const style = boxed.split("\n").find((line) => line.startsWith("Style: Default")) ?? "";
    expect(style).toContain(",3,"); // BorderStyle: opaque box
    expect(style).toContain("&H70000000");
  });

  it("balances two lines instead of leaving a one-word tail", () => {
    const ass = buildAss([{ startMs: 0, endMs: 2_000, text: "온가족이 매일 함께 챙겨 먹는 유산균" }], {
      preset: aspectPreset("9:16"),
    });
    const dialogue = ass.split("\n").find((line) => line.startsWith("Dialogue:")) ?? "";
    const [first, second] = dialogue.split(",,").pop()!.split("\\N");
    expect(first && second).toBeTruthy();
    expect(Math.abs((first?.length ?? 0) - (second?.length ?? 0))).toBeLessThanOrEqual(6);
  });
});

describe("HD ffmpeg plan", () => {
  function request(): RenderRequest {
    const storyboard = buildDemoStoryboard(source, { aspectRatio: "9:16", language: "ko" });
    return {
      storyboard,
      scenes: storyboard.scenes.map((scene) => ({
        scene,
        imagePath: path.join(workDir, "images", `scene-${scene.index}.png`),
        audioPath: path.join(workDir, "audio", `scene-${scene.index}.wav`),
        audioDurationMs: scene.durationMs,
      })),
      subtitlesPath: path.join(workDir, "subtitles.ass"),
      outPath: path.join(workDir, "video.mp4"),
      workDir,
      quality: "final",
    };
  }

  it("scales with lanczos at the native size, not a 2x supersample", () => {
    const plan = buildFfmpegPlan(request());
    expect(plan.filter).toContain("scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos");
    expect(plan.filter).not.toContain("2160");
  });

  it("encodes with crf 18 / preset medium and BT.709 limited-range tags", () => {
    const plan = buildFfmpegPlan(request());
    const args = plan.args;
    const valueOf = (flag: string) => args[args.indexOf(flag) + 1];

    expect(valueOf("-preset")).toBe("medium");
    expect(valueOf("-crf")).toBe("18");
    expect(valueOf("-pix_fmt")).toBe("yuv420p");
    expect(valueOf("-color_range")).toBe("tv");
    expect(valueOf("-colorspace")).toBe("bt709");
    expect(valueOf("-color_primaries")).toBe("bt709");
    expect(valueOf("-color_trc")).toBe("bt709");
    expect(valueOf("-b:a")).toBe("192k");
    expect(plan.filter).toContain("out_color_matrix=bt709");
  });

  it("normalizes loudness to -14 LUFS and still maps the normalized audio", () => {
    const plan = buildFfmpegPlan(request());
    expect(plan.filter).toContain("loudnorm=I=-14:TP=-1.5");
    expect(plan.args).toContain("[aout]");
  });
});
