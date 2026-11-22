import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encodeWav } from "../src/audio/wav";
import { GeminiTtsProvider, geminiVoiceFor } from "../src/audio/gemini";
import { PollinationsImageProvider } from "../src/images/pollinations";
import { createVideoProviders } from "../src/providers";
import { GeminiSttProvider } from "../src/stt/gemini";
import { buildDemoStoryboard } from "../src/demo/storyboard";
import type { SourceDocument } from "@tae/ai";

const originalFetch = globalThis.fetch;

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

describe("gemini providers", () => {
  it("uses Gemini TTS·STT as the real AI path when only GEMINI_API_KEY is set", () => {
    const set = createVideoProviders({ env: { GEMINI_API_KEY: "gm-key" } });
    expect(set.tts.id).toBe("gemini");
    expect(set.stt.id).toBe("gemini");
    expect(set.mode).toBe("gemini");
    // 이미지 생성은 무료 한도가 열린 Pollinations를 유지합니다.
    expect(set.image.id).toBe("pollinations");
    expect(set.imageFallback?.id).toBe("demo");
    expect(set.warnings.join(" ")).toContain("Gemini TTS");
  });

  it("skips OpenAI media when VIDEO_PROVIDER=gemini is set explicitly", () => {
    const set = createVideoProviders({
      env: { OPENAI_API_KEY: "sk-test", GEMINI_API_KEY: "gm-key", VIDEO_PROVIDER: "gemini" },
    });
    expect(set.tts.id).toBe("gemini");
    expect(set.stt.id).toBe("gemini");
    expect(set.image.id).toBe("pollinations");
    expect(set.warnings.join(" ")).toContain("VIDEO_PROVIDER=gemini");
  });

  it("can pin subtitles to deterministic alignment with VIDEO_STT=aligned", () => {
    const set = createVideoProviders({ env: { GEMINI_API_KEY: "gm-key", VIDEO_STT: "aligned" } });
    expect(set.stt.id).toBe("fallback");
    expect(set.tts.id).toBe("gemini");
  });

  it("keeps the free voice when VIDEO_PROVIDER=free", () => {
    const set = createVideoProviders({ env: { GEMINI_API_KEY: "gm-key", VIDEO_PROVIDER: "free" } });
    expect(set.tts.id).toBe("google");
    expect(set.stt.id).toBe("fallback");
  });

  it("lets the OpenAI key win over Gemini for video media", () => {
    const set = createVideoProviders({ env: { OPENAI_API_KEY: "sk-test", GEMINI_API_KEY: "gm-key" } });
    expect(set.image.id).toBe("openai");
    expect(set.tts.id).toBe("openai");
    expect(set.stt.id).toBe("openai");
  });

  it("maps OpenAI voice names onto Gemini preset voices", () => {
    expect(geminiVoiceFor("alloy", "ko")).toBe("Kore");
    expect(geminiVoiceFor("onyx", "ko")).toBe("Fenrir");
    expect(geminiVoiceFor("Kore", "ko")).toBe("Kore");
    expect(geminiVoiceFor(undefined, "ko")).toBe("Kore");
    expect(geminiVoiceFor(undefined, "en")).toBe("Puck");
  });

  it("writes the WAV returned by Gemini TTS and measures its length", async () => {
    const samples = new Float32Array(24_000); // 1초
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / 20) * 0.2;
    const wav = encodeWav(samples, 24_000);

    const calls: { body: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } }] } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const provider = new GeminiTtsProvider({ apiKey: "gm-key", voice: "Kore" });
      const result = await provider.synthesize({
        text: "우리 가족 장 건강을 위해 챙겨 먹기 시작했어요.",
        language: "ko",
        voice: "alloy",
        targetDurationMs: 4_000,
        outPath: path.join(workDir, "audio", "scene-01.wav"),
        sceneIndex: 1,
      });

      expect(result.provider).toBe("gemini");
      expect(result.format).toBe("wav");
      expect(result.durationMs).toBe(1000);
      expect(result.sampleRate).toBe(24_000);
      const written = await readFile(result.path);
      expect(written.length).toBe(wav.length);

      const config = calls[0]?.body.generationConfig as {
        responseModalities: string[];
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
      };
      expect(config.responseModalities).toEqual(["AUDIO"]);
      expect(config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("turns a Gemini transcript into timed cues", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "우리 가족 장 건강을 위해 챙겨 먹기 시작했어요." }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    try {
      const provider = new GeminiSttProvider({ apiKey: "gm-key" });
      const result = await provider.transcribe({
        audioPath: path.join(workDir, "audio", "scene-01.wav"),
        narration: "우리 가족 장 건강을 위해 챙겨 먹기 시작했어요.",
        language: "ko",
        startMs: 0,
        durationMs: 4_000,
        aspectRatio: "9:16",
      });

      expect(result.provider).toBe("gemini");
      expect(result.text).toContain("장 건강");
      expect(result.cues.length).toBeGreaterThan(0);
      expect(result.cues[0]?.startMs).toBe(0);
      expect(result.cues.at(-1)?.endMs).toBeLessThanOrEqual(4_100);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
