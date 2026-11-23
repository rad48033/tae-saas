import { describe, expect, it } from "vitest";

import { cleanTranscript, sttStatus, transcribeMedia } from "../src/lib/stt";

const bytes = Buffer.from("fake-media-bytes");

describe("sttStatus", () => {
  it("prefers OpenAI, then Gemini, and explains when nothing is set", () => {
    expect(sttStatus({ OPENAI_API_KEY: "sk-test" })).toMatchObject({ configured: true, provider: "openai", model: "whisper-1" });
    expect(sttStatus({ GEMINI_API_KEY: "g-test" })).toMatchObject({ configured: true, provider: "gemini" });
    const none = sttStatus({});
    expect(none.configured).toBe(false);
    expect(none.reason).toContain("OPENAI_API_KEY");
  });
});

describe("transcribeMedia", () => {
  it("refuses with a clear message when no provider is configured", async () => {
    await expect(
      transcribeMedia({ bytes, filename: "a.mp4", mimeType: "video/mp4", language: "ko" }, { env: {} }),
    ).rejects.toMatchObject({ code: "stt_unavailable", status: 503 });
  });

  it("sends the file to Whisper and returns the transcript", async () => {
    const captured: { url?: string; body?: FormData } = {};
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(input);
      captured.body = init?.body as FormData;
      return new Response(JSON.stringify({ text: " 릴스는 첫 3초가 전부입니다. ", language: "korean", duration: 42.5 }), {
        status: 200,
      });
    }) as typeof fetch;

    const result = await transcribeMedia(
      { bytes, filename: "reel.mp4", mimeType: "video/mp4", language: "ko" },
      { env: { OPENAI_API_KEY: "sk-test" }, fetchImpl },
    );

    expect(result.provider).toBe("openai");
    expect(result.text).toBe("릴스는 첫 3초가 전부입니다.");
    expect(result.seconds).toBe(42.5);
    expect(captured?.url).toContain("/audio/transcriptions");
    expect(String(captured?.body?.get("model"))).toBe("whisper-1");
    expect(String(captured?.body?.get("language"))).toBe("ko");
  });

  it("maps a quota error to a retryable AI error", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: "rate limit reached" } }), { status: 429 })) as typeof fetch;
    await expect(
      transcribeMedia({ bytes, filename: "a.mp4", mimeType: "video/mp4", language: "ko" }, { env: { OPENAI_API_KEY: "k" }, fetchImpl }),
    ).rejects.toMatchObject({ code: "ai_failed", status: 429 });
  });

  it("explains an empty transcript instead of returning blank text", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ text: "   " }), { status: 200 })) as typeof fetch;
    await expect(
      transcribeMedia({ bytes, filename: "a.mp4", mimeType: "video/mp4", language: "ko" }, { env: { OPENAI_API_KEY: "k" }, fetchImpl }),
    ).rejects.toMatchObject({ code: "stt_unavailable", details: { reason: "no_speech" } });
  });

  it("uses Gemini inline data when only the Gemini key exists", async () => {
    let body: { contents?: { parts?: { inlineData?: { mimeType?: string } }[] }[] } | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("generateContent");
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "영상 음성 전사문" }] } }] }), {
        status: 200,
      });
    }) as typeof fetch;

    const result = await transcribeMedia(
      { bytes, filename: "clip.mp4", mimeType: "video/mp4", language: "ko" },
      { env: { GEMINI_API_KEY: "g" }, fetchImpl },
    );
    expect(result.provider).toBe("gemini");
    expect(result.text).toBe("영상 음성 전사문");
    expect(body?.contents?.[0]?.parts?.[0]?.inlineData?.mimeType).toBe("video/mp4");
  });

  it("refuses files larger than the provider limit", async () => {
    const big = Buffer.alloc(26 * 1024 * 1024);
    await expect(
      transcribeMedia({ bytes: big, filename: "big.mp4", mimeType: "video/mp4", language: "ko" }, { env: { OPENAI_API_KEY: "k" } }),
    ).rejects.toMatchObject({ code: "file_too_large", status: 413 });
  });
});

describe("cleanTranscript", () => {
  it("normalizes whitespace and blank lines", () => {
    expect(cleanTranscript("  첫 줄 \r\n\r\n\r\n 둘째   줄  ")).toBe("첫 줄\n\n둘째 줄");
  });
});
