import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DemoImageProvider } from "./demo";
import type { GeneratedImage, ImageProvider, ImageRequest } from "../types";

/**
 * API 키 없이 쓰는 이미지 생성.
 *
 * Pollinations의 공개 이미지 엔드포인트는 키 없이 프롬프트로 JPEG를 돌려줍니다.
 * 무료 한도가 "IP당 45초에 1장"이라 장면 수만큼 기다려야 하므로,
 *   - 프롬프트 해시로 디스크 캐시를 남기고(재렌더는 즉시),
 *   - 요청 사이에 최소 간격을 두고 순차 실행하고,
 *   - 한도 응답(402)이 오면 안내된 시간만큼 기다렸다 한 번 더 시도합니다.
 * 그래도 실패하면 카드 이미지(DemoImageProvider)로 넘어갑니다.
 */

export interface PollinationsImageOptions {
  baseUrl?: string;
  /** 요청 사이 최소 간격(무료 한도: 45초) */
  minIntervalMs?: number;
  /** 한 장을 기다리는 최대 시간 */
  maxWaitMs?: number;
  timeoutMs?: number;
  cacheDir?: string;
  model?: string;
}

const DEFAULT_BASE_URL = "https://image.pollinations.ai/prompt";
const DEFAULT_CACHE_DIR = path.join(tmpdir(), "tae-video-image-cache");

export class PollinationsImageProvider implements ImageProvider {
  readonly id = "pollinations" as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly timeoutMs: number;
  private readonly cacheDir: string;
  private readonly fallback = new DemoImageProvider();
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: PollinationsImageOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = options.model ?? "sana";
    this.minIntervalMs = options.minIntervalMs ?? 46_000;
    this.maxWaitMs = options.maxWaitMs ?? 90_000;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.cacheDir = options.cacheDir ?? process.env.VIDEO_IMAGE_CACHE_DIR ?? DEFAULT_CACHE_DIR;
  }

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const prompt = cleanPrompt(request.scene.visualPrompt);
    const outPath = request.outPath.replace(/\.png$/i, ".jpg");
    const seed = seedFor(prompt);
    const cacheKey = createHash("sha1").update(`${this.model}|${seed}|${prompt}`).digest("hex").slice(0, 20);
    const cachePath = path.join(this.cacheDir, `${cacheKey}.jpg`);

    const cached = await readFile(cachePath).catch(() => null);
    if (cached && cached.length > 1_000) {
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, cached);
      await writeFile(`${request.outPath}.prompt.txt`, `${request.scene.visualPrompt}\n`, "utf8");
      return {
        sceneIndex: request.scene.index,
        path: outPath,
        width: request.width,
        height: request.height,
        provider: "pollinations",
        model: `${this.model} (cache)`,
        prompt: request.scene.visualPrompt,
      };
    }

    try {
      const jpeg = await this.enqueue(() => this.fetchImage(prompt, seed, request.width, request.height));
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(cachePath, jpeg).catch(() => undefined);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, jpeg);
      await writeFile(`${request.outPath}.prompt.txt`, `${request.scene.visualPrompt}\n`, "utf8");

      return {
        sceneIndex: request.scene.index,
        path: outPath,
        width: request.width,
        height: request.height,
        provider: "pollinations",
        model: this.model,
        prompt: request.scene.visualPrompt,
      };
    } catch {
      // 무료 한도·차단·시간 초과: 카드 이미지로 대체하고 장면은 계속 진행합니다.
      const card = await this.fallback.generate(request);
      return { ...card, model: "demo-gradient (image fallback)" };
    }
  }

  /** 무료 한도 때문에 요청을 한 줄로 세웁니다. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      return task();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fetchImage(prompt: string, seed: number, width: number, height: number): Promise<Buffer> {
    const url =
      `${this.baseUrl}/${encodeURIComponent(prompt)}` +
      `?width=${Math.min(1536, width)}&height=${Math.min(1536, height)}` +
      `&seed=${seed}&nologo=true&model=${encodeURIComponent(this.model)}&enhance=false`;

    let waitMs = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (waitMs > 0) {
        if (waitMs > this.maxWaitMs) break;
        await sleep(waitMs);
      }

      const response = await fetch(url, {
        headers: { accept: "image/jpeg,image/png" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const type = response.headers.get("content-type") ?? "";

      if (response.ok && type.startsWith("image/")) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 1_000) return bytes;
        throw new Error("이미지 응답이 비어 있습니다.");
      }

      if (response.status === 402 || response.status === 429) {
        const payload = await response.json().catch(() => null) as
          | { error?: { message?: string } }
          | null;
        const message = payload?.error?.message ?? "";
        const retry = /retry after (\d+)/i.exec(message);
        waitMs = retry?.[1] ? Number(retry[1]) * 1_000 + 1_000 : 46_000;
        continue;
      }

      const text = await response.text().catch(() => "");
      throw new Error(`무료 이미지 생성 응답 ${response.status}: ${text.slice(0, 160)}`);
    }

    throw new Error("무료 이미지 생성 한도에 걸려 카드 이미지로 대체했습니다.");
  }
}

function cleanPrompt(prompt: string): string {
  // 이미지 모델은 영어 프롬프트를 잘 따릅니다. 한글 제목이 섞여도 앞의 장면 묘사를 유지합니다.
  return prompt.replace(/\s+/g, " ").trim().slice(0, 700);
}

function seedFor(prompt: string): number {
  const hash = createHash("sha1").update(prompt).digest();
  return hash.readUInt32BE(0) % 1_000_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
