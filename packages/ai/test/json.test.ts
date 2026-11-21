import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AiResponseError, completeJson, extractJson } from "../src/json";
import type { AiProvider, CompletionRequest, CompletionResult } from "../src/types";

const schema = z.object({ title: z.string(), tags: z.array(z.string()).min(1) });

function fakeProvider(responses: string[]): AiProvider & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  let index = 0;
  return {
    id: "demo",
    model: "fake",
    calls,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      calls.push(request);
      const text = responses[Math.min(index, responses.length - 1)] ?? "";
      index += 1;
      return { text, usage: { inputTokens: 10, outputTokens: 5 }, model: "fake", provider: "demo", stopReason: "end_turn" };
    },
  };
}

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("ignores prose around the object", () => {
    expect(extractJson('결과는 다음과 같습니다.\n{"a":{"b":2}}\n감사합니다.')).toEqual({ a: { b: 2 } });
  });

  it("parses arrays", () => {
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it("throws a typed error for empty responses", () => {
    expect(() => extractJson("   ")).toThrow(AiResponseError);
  });
});

describe("completeJson", () => {
  it("returns validated data on the first try", async () => {
    const provider = fakeProvider(['{"title":"hello","tags":["a"]}']);
    const result = await completeJson(provider, { system: "s", prompt: "p" }, schema);
    expect(result.value).toEqual({ title: "hello", tags: ["a"] });
    expect(result.repaired).toBe(false);
    expect(provider.calls).toHaveLength(1);
  });

  it("asks the model to repair an invalid answer once", async () => {
    const provider = fakeProvider(['{"title":"hello","tags":[]}', '{"title":"hello","tags":["fixed"]}']);
    const result = await completeJson(provider, { system: "s", prompt: "p" }, schema);
    expect(result.value.tags).toEqual(["fixed"]);
    expect(result.repaired).toBe(true);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.messages.at(-1)?.content).toContain("스키마");
  });

  it("accumulates token usage across attempts and throws after repairs are exhausted", async () => {
    const provider = fakeProvider(["not json", "still not json"]);
    await expect(completeJson(provider, { system: "s", prompt: "p" }, schema, { repairs: 1 })).rejects.toThrow(
      AiResponseError,
    );
    expect(provider.calls).toHaveLength(2);
  });
});
