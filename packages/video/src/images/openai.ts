import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GeneratedImage, ImageProvider, ImageRequest, ResolvedReferenceImage } from "../types";

export interface OpenAIImageOptions {
  apiKey: string;
  /** gpt-image-2 | gpt-image-1.5 | gpt-image-1-mini | dall-e-3 등 */
  model?: string;
  baseUrl?: string;
  /** low | medium | high | auto (미설정 시 high) */
  quality?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * 기본 이미지 모델.
 * gpt-image-1은 이 계정에서 "The model 'gpt-image-1' does not exist"로 거부됩니다.
 */
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
/** 기본 모델이 조직 인증·모델 중단으로 실패할 때의 대체 모델. */
export const DEFAULT_IMAGE_FALLBACK_MODEL = "gpt-image-1-mini";
/**
 * 기본 이미지 품질. low는 장당 6원 수준이지만 인물·제품 경계가 뭉개지고,
 * high는 장당 200~330원으로 릴스·쇼츠 화면에 그대로 쓸 수 있는 결이 나옵니다.
 * 비용을 아껴야 할 때만 OPENAI_IMAGE_QUALITY=low/medium으로 낮춥니다.
 */
export const DEFAULT_IMAGE_QUALITY = "high";

/** Images 편집(참조 이미지)을 지원하는 모델. dall-e-*는 편집을 지원하지 않습니다. */
export function supportsReferenceImages(model: string): boolean {
  return model.startsWith("gpt-image");
}

/** gpt-image-2만 input_fidelity를 받지 않습니다(400 invalid_input_fidelity_model). */
function supportsInputFidelity(model: string): boolean {
  return model.startsWith("gpt-image-1");
}

interface ImageApiResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  error?: { message?: string; type?: string; code?: string };
}

/**
 * OpenAI Images 어댑터.
 * - gpt-image-2: 16의 배수면 임의 크기 생성. 9:16=1088x1920, 16:9=1920x1088 네이티브.
 *   (1080x1920은 16의 배수가 아니라 거부됩니다. 1088x1920은 ffmpeg에서 8px만 잘라 1080x1920으로 씁니다.)
 * - gpt-image-1.5 / gpt-image-1-mini: 세로 1024x1536 / 가로 1536x1024
 * - dall-e-3: 세로 1024x1792 / 가로 1792x1024
 *
 * 참조 이미지(`referenceImages`)가 있으면 `/images/edits`로 보내 실제 제품 사진의
 * 패키지 외관을 유지한 장면을 만듭니다(텍스트만으로 상상해 그리지 않습니다).
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly quality: string;
  private readonly timeoutMs: number;
  /** 로그·manifest에 남길 품질 표기(auto면 서버 기본값). */
  readonly qualityLabel: string;

  constructor(options: OpenAIImageOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || DEFAULT_IMAGE_MODEL;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.quality = normalizeQuality(options.quality);
    this.qualityLabel = this.quality;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const size = imageSizeFor(this.model, request.aspectRatio);
    const references = usableReferences(request.referenceImages);
    const prompt = buildImagePrompt(request, references);
    const mode: "generate" | "edit" = references.length > 0 && supportsReferenceImages(this.model) ? "edit" : "generate";

    const payload =
      mode === "edit"
        ? await this.requestEditWithRetry({ prompt, size, references })
        : await this.requestWithRetry<ImageApiResponse>("/images/generations", {
            model: this.model,
            prompt,
            n: 1,
            size,
            // dall-e는 quality 값이 standard|hd라 gpt-image 품질값을 보내면 거부됩니다.
            ...(this.model.startsWith("dall-e")
              ? { response_format: "b64_json" }
              : { quality: this.quality, output_format: "png" }),
          });

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
    await writeFile(
      `${request.outPath}.prompt.txt`,
      [
        prompt,
        `mode: ${mode}`,
        `quality: ${this.quality}`,
        references.length > 0 ? `references: ${references.map((reference) => reference.label).join(", ")}` : "",
        `revised: ${first.revised_prompt ?? ""}`,
        "",
      ]
        .filter((line) => line !== "")
        .join("\n"),
      "utf8",
    );

    const [generatedWidth, generatedHeight] = size.split("x").map((value) => Number(value));

    return {
      sceneIndex: request.scene.index,
      path: request.outPath,
      width: generatedWidth || request.width,
      height: generatedHeight || request.height,
      provider: "openai",
      model: this.model,
      prompt,
      mode,
      referenceCount: references.length,
    };
  }

  private async requestEditWithRetry(input: {
    prompt: string;
    size: string;
    references: ResolvedReferenceImage[];
  }): Promise<ImageApiResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // FormData는 한 번만 쓸 수 있으므로 시도마다 새로 만듭니다.
        const form = new FormData();
        form.append("model", this.model);
        form.append("prompt", input.prompt);
        form.append("size", input.size);
        form.append("quality", this.quality);
        form.append("n", "1");
        form.append("output_format", "png");
        if (supportsInputFidelity(this.model)) form.append("input_fidelity", "high");
        for (const reference of input.references) {
          form.append("image[]", new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType }), reference.filename);
        }

        const response = await fetch(`${this.baseUrl}/images/edits`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await response.text();
        const parsed = safeJson<ImageApiResponse>(text);

        if (!response.ok) {
          const message = parsed?.error?.message ?? text.slice(0, 300);
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await sleep(2_000 * (attempt + 1));
            lastError = new Error(`OpenAI Images(edit) ${response.status}: ${message}`);
            continue;
          }
          throw new Error(`OpenAI Images(edit) ${response.status}: ${message}`);
        }

        if (!parsed) throw new Error("OpenAI Images(edit) 응답을 JSON으로 읽지 못했습니다.");
        return parsed;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("OpenAI Images(edit) 요청 시간 초과");
        if (attempt >= 2) throw error instanceof Error ? error : new Error(String(error));
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(2_000 * (attempt + 1));
      }
    }

    throw lastError ?? new Error("OpenAI Images(edit) 요청 실패");
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

export function normalizeQuality(value: string | undefined): string {
  const quality = value?.trim().toLowerCase();
  if (quality === "low" || quality === "medium" || quality === "high" || quality === "auto") return quality;
  return DEFAULT_IMAGE_QUALITY;
}

/** 편집 요청에 실을 수 있는 참조 이미지만 남깁니다(최대 16장, 모델이 지원할 때). */
export function usableReferences(references: ResolvedReferenceImage[] | undefined): ResolvedReferenceImage[] {
  return (references ?? []).filter((reference) => reference.bytes.byteLength > 0).slice(0, 16);
}

/**
 * 장면 프롬프트 + 참조 이미지 지시문.
 *
 * 제품 사진을 넘길 때 가장 중요한 두 가지:
 *  1) 패키지 디자인(로고·색·인쇄 문구)을 새로 그리지 말고 첨부 사진과 같게 유지
 *  2) 사진 속 제품을 장면에 자연스럽게 배치(같은 각도·재질·라벨 크기)
 */
export function buildImagePrompt(request: ImageRequest, references: ResolvedReferenceImage[]): string {
  const base = request.scene.visualPrompt.trim();
  if (references.length === 0) return base;

  const products = references.filter((reference) => reference.role === "product");
  const scenes = references.filter((reference) => reference.role === "scene");
  const styles = references.filter((reference) => reference.role === "style");
  const lines: string[] = [base];

  if (products.length > 0) {
    const names = products.map((reference) => reference.label).join(", ");
    lines.push(
      `The attached reference photo${products.length > 1 ? "s" : ""} (${names}) show the actual product packaging.`,
      "Reproduce that exact package in this scene: same box shape and proportions, same light-blue color, same logo and Korean printed text, same stick sachets. Do not redesign, rename, or invent a different package.",
      "Place it naturally in the described scene with believable perspective, lighting and shadow; keep the package sharp and fully readable.",
    );
  }
  if (scenes.length > 0) {
    lines.push(
      `Use the attached location photo${scenes.length > 1 ? "s" : ""} (${scenes.map((reference) => reference.label).join(", ")}) as the real space for this scene; keep its layout and materials.`,
    );
  }
  if (styles.length > 0) {
    lines.push(`Match the color grading and lighting of the attached style reference (${styles.map((reference) => reference.label).join(", ")}).`);
  }
  lines.push("Do not add new text overlays, captions, or watermarks; only the packaging's own printed design is allowed.");
  return lines.join(" ");
}

export function imageSizeFor(model: string, aspectRatio: "9:16" | "16:9"): string {
  if (model.startsWith("dall-e")) {
    return aspectRatio === "9:16" ? "1024x1792" : "1792x1024";
  }
  // gpt-image-2는 16의 배수 크기를 그대로 생성합니다. 최종 영상(1080x1920)보다
  // 넓게 뽑아 두어 ffmpeg가 줄이기만 하고 늘리지 않게 합니다(화질 손실 없음).
  if (model.startsWith("gpt-image-2")) {
    return aspectRatio === "9:16" ? "1088x1920" : "1920x1088";
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
