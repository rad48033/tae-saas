import { afterEach, describe, expect, it, vi } from "vitest";

import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "../src/gemini-provider";
import { createOpenAIProvider, DEFAULT_OPENAI_MODEL } from "../src/openai-provider";
import { createAiService, createTextProviderFromEnv } from "../src/service";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(response: { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

describe("text provider selection", () => {
  it("prefers Claude, then OpenAI, then Gemini", () => {
    const all = createAiService({
      apiKey: "sk-ant",
      openai: { apiKey: "sk-openai" },
      gemini: { apiKey: "gm-key" },
    });
    expect(all.mode).toBe("anthropic");

    const openai = createAiService({ openai: { apiKey: "sk-openai" }, gemini: { apiKey: "gm-key" } });
    expect(openai.mode).toBe("openai");
    expect(openai.model).toBe(DEFAULT_OPENAI_MODEL);

    const gemini = createAiService({ gemini: { apiKey: "gm-key" } });
    expect(gemini.mode).toBe("gemini");
    expect(gemini.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("falls back to demo when no key is given", () => {
    expect(createAiService().mode).toBe("demo");
    expect(createAiService({ providerId: "demo", openai: { apiKey: "sk-openai" } }).mode).toBe("demo");
  });

  it("honours AI_PROVIDER but ignores it when the key is missing", () => {
    const env = { AI_PROVIDER: "gemini", OPENAI_API_KEY: "sk-openai", GEMINI_API_KEY: "gm-key" };
    expect(createTextProviderFromEnv(env)?.id).toBe("gemini");

    // Gemini 키가 없으면 자동 순서(OpenAI)로 돌아갑니다.
    expect(createTextProviderFromEnv({ AI_PROVIDER: "gemini", OPENAI_API_KEY: "sk-openai" })?.id).toBe("openai");

    // demo를 명시하면 키가 있어도 데모입니다.
    expect(createTextProviderFromEnv({ AI_PROVIDER: "demo", OPENAI_API_KEY: "sk-openai" })).toBeNull();

    // 키가 하나도 없으면 null(데모).
    expect(createTextProviderFromEnv({})).toBeNull();
  });

  it("reads provider-specific models from env", () => {
    const provider = createTextProviderFromEnv({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "gm-key",
      GEMINI_MODEL: "gemini-3.8-flash",
    });
    expect(provider?.model).toBe("gemini-3.8-flash");

    const openai = createTextProviderFromEnv({ OPENAI_API_KEY: "sk", OPENAI_TEXT_MODEL: "gpt-4o" });
    expect(openai?.model).toBe("gpt-4o");
  });
});

describe("OpenAI provider", () => {
  it("sends a system message, JSON mode and reads usage", async () => {
    const calls = mockFetch({
      body: {
        model: "gpt-4o-mini-2024-07-18",
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      },
    });

    const provider = createOpenAIProvider({ apiKey: "sk-openai", maxRetries: 0 });
    const result = await provider.complete({
      system: "시스템 지시",
      messages: [{ role: "user", content: "본문" }],
      maxTokens: 512,
      json: true,
    });

    expect(result.text).toBe('{"ok":true}');
    expect(result.provider).toBe("openai");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(result.stopReason).toBe("stop");

    const [call] = calls;
    expect(call?.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-openai");
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.max_tokens).toBe(512);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect((body.messages as { role: string }[])[0]).toEqual({ role: "system", content: "시스템 지시" });
  });

  it("uses max_completion_tokens for gpt-5 style models", async () => {
    const calls = mockFetch({ body: { choices: [{ message: { content: "ok" } }] } });
    const provider = createOpenAIProvider({ apiKey: "sk", model: "gpt-5.4-mini", maxRetries: 0 });
    await provider.complete({ system: "s", messages: [{ role: "user", content: "u" }], maxTokens: 256 });

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(256);
    expect(body.max_tokens).toBeUndefined();
  });

  it("surfaces the quota error instead of silently degrading", async () => {
    mockFetch({
      status: 429,
      body: { error: { message: "You have no credits remaining.", type: "insufficient_quota" } },
    });
    const provider = createOpenAIProvider({ apiKey: "sk", maxRetries: 0 });

    await expect(provider.complete({ system: "s", messages: [{ role: "user", content: "u" }] })).rejects.toThrow(
      /no credits remaining/,
    );
  });
});

describe("Gemini provider", () => {
  it("maps roles, drops thought parts and reads usage", async () => {
    const calls = mockFetch({
      body: {
        modelVersion: "gemini-3.8-flash",
        candidates: [
          {
            content: {
              parts: [{ text: "생각", thought: true }, { text: '{"ok":' }, { text: "true}" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 },
      },
    });

    const provider = createGeminiProvider({ apiKey: "gm-key", maxRetries: 0 });
    const result = await provider.complete({
      system: "시스템 지시",
      messages: [
        { role: "user", content: "본문" },
        { role: "assistant", content: "이전 응답" },
        { role: "user", content: "교정" },
      ],
      maxTokens: 1024,
      json: true,
    });

    expect(result.text).toBe('{"ok":true}');
    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-3.8-flash");
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 50 });

    const [call] = calls;
    expect(call?.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`,
    );
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gm-key");
    const body = JSON.parse(String(call?.init.body)) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string }[];
      generationConfig: Record<string, unknown>;
    };
    expect(body.systemInstruction.parts[0]?.text).toBe("시스템 지시");
    expect(body.contents.map((entry) => entry.role)).toEqual(["user", "model", "user"]);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.maxOutputTokens).toBe(1024);
    // 사고 토큰을 꺼서 구조화 응답을 빨리 받습니다.
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("reports a blocked prompt instead of returning empty text", async () => {
    mockFetch({ body: { promptFeedback: { blockReason: "SAFETY" }, candidates: [] } });
    const provider = createGeminiProvider({ apiKey: "gm-key", maxRetries: 0 });

    await expect(provider.complete({ system: "s", messages: [{ role: "user", content: "u" }] })).rejects.toThrow(
      /SAFETY/,
    );
  });

  it("moves to the next model when the default one is overloaded", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);
      if (href.includes(encodeURIComponent(DEFAULT_GEMINI_MODEL))) {
        return new Response(
          JSON.stringify({
            error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          modelVersion: "gemini-3-flash-preview",
          candidates: [{ content: { parts: [{ text: "대체 모델 응답" }] }, finishReason: "STOP" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const provider = createGeminiProvider({ apiKey: "gm-key", maxRetries: 0 });
    const result = await provider.complete({ system: "s", messages: [{ role: "user", content: "u" }] });

    expect(result.text).toBe("대체 모델 응답");
    expect(result.model).toBe("gemini-3-flash-preview");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("gemini-3-flash-preview");
  });

  it("retries without thinkingConfig when the model rejects the field (400)", async () => {
    const bodies: string[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      bodies.push(body);
      if (body.includes("thinkingConfig")) {
        return new Response(
          JSON.stringify({ error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const provider = createGeminiProvider({ apiKey: "gm-key", maxRetries: 0, model: "gemini-flash-lite-latest" });
    const result = await provider.complete({ system: "s", messages: [{ role: "user", content: "u" }] });

    expect(result.text).toBe("ok");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toContain("thinkingConfig");
  });

  it("keeps a hard error (bad key) instead of trying other models", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key." } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const provider = createGeminiProvider({ apiKey: "bad", maxRetries: 0 });
    await expect(provider.complete({ system: "s", messages: [{ role: "user", content: "u" }] })).rejects.toThrow(
      /API key not valid/,
    );
    expect(calls).toHaveLength(1);
  });
});
