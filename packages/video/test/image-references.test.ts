import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_IMAGE_QUALITY,
  OpenAIImageProvider,
  buildImagePrompt,
  normalizeQuality,
  supportsReferenceImages,
} from "../src/images/openai";
import { createVideoProviders } from "../src/providers";
import type { ImageRequest, ResolvedReferenceImage, StoryboardScene } from "../src/types";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "tae-openai-img-"));
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const scene: StoryboardScene = {
  index: 1,
  title: "제품 소개",
  narration: "쁘띠앤 락토프리미엄입니다.",
  visualPrompt: "A light blue supplement box on a pale wooden kitchen table.",
  startMs: 0,
  endMs: 5_000,
  durationMs: 5_000,
};

function reference(): ResolvedReferenceImage {
  return {
    bytes: Buffer.from(PNG_BASE64, "base64"),
    mimeType: "image/png",
    filename: "reference-01.png",
    label: "제품 박스 정면",
    role: "product",
    origin: "https://cdn.example.com/box.png",
    sha256: "abc1234567",
  };
}

function request(outPath: string, referenceImages?: ResolvedReferenceImage[]): ImageRequest {
  return {
    scene,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    style: "editorial photography",
    outPath,
    ...(referenceImages ? { referenceImages } : {}),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("image quality defaults", () => {
  it("defaults to high", () => {
    expect(DEFAULT_IMAGE_QUALITY).toBe("high");
    expect(normalizeQuality(undefined)).toBe("high");
    expect(normalizeQuality("  ")).toBe("high");
    expect(normalizeQuality("low")).toBe("low");
    expect(normalizeQuality("medium")).toBe("medium");
    expect(normalizeQuality("weird")).toBe("high");
  });

  it("sends quality=high on a generation request when the env var is unset", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );

    const provider = new OpenAIImageProvider({ apiKey: "sk-test" });
    expect(provider.qualityLabel).toBe("high");
    const result = await provider.generate(request(path.join(workDir, "scene-01.png")));

    expect(bodies[0]?.quality).toBe("high");
    expect(bodies[0]?.size).toBe("1088x1920");
    expect(result.mode).toBe("generate");
    expect(result.referenceCount).toBe(0);
  });

  it("createVideoProviders uses high unless OPENAI_IMAGE_QUALITY overrides it", () => {
    const defaults = createVideoProviders({ env: { OPENAI_API_KEY: "sk-test", VIDEO_PROVIDER: "openai" } });
    expect((defaults.image as OpenAIImageProvider).qualityLabel).toBe("high");

    const lowered = createVideoProviders({
      env: { OPENAI_API_KEY: "sk-test", VIDEO_PROVIDER: "openai", OPENAI_IMAGE_QUALITY: "medium" },
    });
    expect((lowered.image as OpenAIImageProvider).qualityLabel).toBe("medium");
  });
});

describe("OpenAIImageProvider with reference photos", () => {
  it("posts multipart to /images/edits and keeps product, size and quality", async () => {
    const calls: { url: string; form: FormData }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), form: init?.body as FormData });
        return jsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );

    const provider = new OpenAIImageProvider({ apiKey: "sk-test" });
    const outPath = path.join(workDir, "scene-edit.png");
    const result = await provider.generate(request(outPath, [reference()]));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/v1\/images\/edits$/);
    const form = calls[0]!.form;
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("size")).toBe("1088x1920");
    expect(form.get("quality")).toBe("high");
    expect(form.get("output_format")).toBe("png");
    // gpt-image-2는 input_fidelity를 받지 않습니다(400 invalid_input_fidelity_model).
    expect(form.get("input_fidelity")).toBeNull();
    expect(form.getAll("image[]")).toHaveLength(1);
    expect(String(form.get("prompt"))).toContain("the actual product packaging");
    expect(String(form.get("prompt"))).toContain("same logo and Korean printed text");

    expect(result.mode).toBe("edit");
    expect(result.referenceCount).toBe(1);
    const written = await readFile(outPath);
    expect(written.equals(Buffer.from(PNG_BASE64, "base64"))).toBe(true);
    const promptFile = await readFile(`${outPath}.prompt.txt`, "utf8");
    expect(promptFile).toContain("mode: edit");
    expect(promptFile).toContain("제품 박스 정면");
  });

  it("adds input_fidelity only for gpt-image-1 family models", async () => {
    const forms: FormData[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        forms.push(init?.body as FormData);
        return jsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );

    const provider = new OpenAIImageProvider({ apiKey: "sk-test", model: "gpt-image-1.5" });
    await provider.generate(request(path.join(workDir, "scene-15.png"), [reference()]));

    expect(forms[0]?.get("input_fidelity")).toBe("high");
    expect(forms[0]?.get("size")).toBe("1024x1536");
  });

  it("tells the model to keep the packaging instead of removing logos", () => {
    const prompt = buildImagePrompt(request("x.png"), [reference()]);
    expect(prompt).toContain("Reproduce that exact package");
    expect(prompt).toContain("Do not redesign, rename, or invent a different package");
    expect(prompt).not.toContain("no logos");
  });

  it("skips the edit path for models without image input", () => {
    expect(supportsReferenceImages("gpt-image-2")).toBe(true);
    expect(supportsReferenceImages("dall-e-3")).toBe(false);
  });

  it("falls back to a plain generation when no reference image could be read", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return jsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );

    await writeFile(path.join(workDir, "empty.png"), Buffer.alloc(0));
    const provider = new OpenAIImageProvider({ apiKey: "sk-test" });
    await provider.generate(request(path.join(workDir, "scene-plain.png"), []));

    expect(urls[0]).toMatch(/\/v1\/images\/generations$/);
  });
});
