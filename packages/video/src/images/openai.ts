import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GeneratedImage, ImageProvider, ImageRequest } from "../types";

export interface OpenAIImageOptions {
  apiKey: string;
  /** gpt-image-1 | dall-e-3 등 */
  model?: string;
  baseUrl?: string;
  quality?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface ImageApiResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  error?: { message?: string; type?: string; code?: string };
}

/**
 * OpenAI Images 어댑터.
 * - gpt-image-1: 세로 1024x1536 / 가로 1536x1024, b64_json 응답
 * - dall-e-3: 세로 1024x1792 / 가로 1792x1024
 * 실제 영상 해상도로는 ffmpeg가 크롭·스케일합니다.
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly quality: string | null;
  private readonly timeoutMs: number;

  constructor(options: OpenAIImageOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || "gpt-image-1";
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.quality = options.quality?.trim() || null;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const size = imageSizeFor(this.model, request.aspectRatio);
    const prompt = request.scene.visualPrompt;

    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      n: 1,
      size,
    };
    if (this.quality) body.quality = this.quality;
    if (this.model.startsWith("dall-e")) body.response_format = "b64_json";
    else body.output_format = "png";

    const payload = await this.requestWithRetry<ImageApiResponse>("/images/generations", body);
    const first = payload.data?.[0];
    if (!first) throw new Error("OpenAI Images 응답에 data[0]이 없습니다.");

    let bytes: Buffer;
    if (first.b64_json) {
      bytes = Buffer.from(first.b64_json, "base64");
    } else if (first.url) {
      const response = await fetch(first.url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error(`이미지 URL 다운로드 실패: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      throw new Error("OpenAI Images 응답에 이미지가 없습니다.");
    }

    await mkdir(path.dirname(request.outPath), { recursive: true });
    await writeFile(request.outPath, bytes);
    await writeFile(`${request.outPath}.prompt.txt`, `${prompt}\nrevised: ${first.revised_prompt ?? ""}\n`, "utf8");

    return {
      sceneIndex: request.scene.index,
      path: request.outPath,
      width: request.width,
      height: request.height,
      provider: "openai",
      prompt,
    };
  }

  private async requestWithRetry<T>(pathname: string, body: Record<string, unknown>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${pathname}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await response.text();
        const parsed = safeJson<T & ImageApiResponse>(text);

        if (!response.ok) {
          const message = parsed?.error?.message ?? text.slice(0, 300);
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await sleep(1_500 * (attempt + 1));
            lastError = new Error(`OpenAI Images ${response.status}: ${message}`);
            continue;
          }
          throw new Error(`OpenAI Images ${response.status}: ${message}`);
        }

        if (!parsed) throw new Error("OpenAI Images 응답을 JSON으로 읽지 못했습니다.");
        return parsed;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("OpenAI Images 요청 시간 초과");
        if (attempt >= 2) throw error instanceof Error ? error : new Error(String(error));
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(1_500 * (attempt + 1));
      }
    }

    throw lastError ?? new Error("OpenAI Images 요청 실패");
  }
}

export function imageSizeFor(model: string, aspectRatio: "9:16" | "16:9"): string {
  if (model.startsWith("dall-e")) {
    return aspectRatio === "9:16" ? "1024x1792" : "1792x1024";
  }
  return aspectRatio === "9:16" ? "1024x1536" : "1536x1024";
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
