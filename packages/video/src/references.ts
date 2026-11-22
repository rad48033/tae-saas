import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ReferenceImage, ReferenceImageRole, ResolvedReferenceImage, StoryboardReference } from "./types";

/**
 * 실제 제품 사진(참조 이미지) 입력 정규화.
 *
 * 이미지 생성 단계는 이 바이트들을 OpenAI Images 편집(`/images/edits`)에 함께 넘겨
 * 텍스트만으로 제품 패키지를 상상해 그리는 대신, 제공된 패키지의 외관·로고·색·인쇄 문구를
 * 장면마다 유지합니다.
 *
 * 지원 입력:
 *   { url: "https://…" }        — 워커·서버에서 직접 내려받습니다(사설망 차단)
 *   { path: "./ref/box.jpg" }   — 로컬 렌더(CLI·스크립트)에서 그대로 읽습니다
 *   { data: "data:image/png;base64,…" } — 브라우저 첨부·붙여넣기
 */

export const DEFAULT_MAX_REFERENCE_IMAGES = 6;
/** Images 편집 API가 한 요청에 받는 이미지 수 상한 */
export const MAX_EDIT_IMAGES = 16;
export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;

const SUPPORTED_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const FETCH_TIMEOUT_MS = 20_000;

export class ReferenceImageError extends Error {
  constructor(message: string, readonly reference?: string) {
    super(message);
    this.name = "ReferenceImageError";
  }
}

export interface ResolveReferenceOptions {
  /** 최대 장수 (기본 6) */
  maxImages?: number;
  maxBytes?: number;
  /** 테스트·로컬 전용. true면 사설망 URL 허용 */
  allowPrivateHosts?: boolean;
  timeoutMs?: number;
}

/**
 * 입력 목록을 실제 바이트로 읽습니다.
 * 같은 출처(origin+해시)가 중복되면 한 번만 남기고, 읽지 못한 입력은 건너뜁니다.
 */
export async function resolveReferenceImages(
  inputs: readonly ReferenceImage[] | undefined,
  options: ResolveReferenceOptions = {},
): Promise<{ images: ResolvedReferenceImage[]; errors: string[] }> {
  const maxImages = Math.min(options.maxImages ?? DEFAULT_MAX_REFERENCE_IMAGES, MAX_EDIT_IMAGES);
  const maxBytes = options.maxBytes ?? MAX_REFERENCE_BYTES;
  const images: ResolvedReferenceImage[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const [index, input] of (inputs ?? []).entries()) {
    if (images.length >= maxImages) {
      errors.push(`참조 이미지는 최대 ${maxImages}장까지 반영합니다. 나머지는 건너뛰었습니다.`);
      break;
    }

    try {
      const resolved = await resolveOne(input, index, {
        maxBytes,
        ...(options.allowPrivateHosts ? { allowPrivateHosts: true } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      });
      if (seen.has(resolved.sha256)) continue;
      seen.add(resolved.sha256);
      images.push(resolved);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`참조 이미지 ${index + 1}장을 읽지 못했습니다: ${message}`);
    }
  }

  return { images, errors };
}

async function resolveOne(
  input: ReferenceImage,
  index: number,
  options: { maxBytes: number; allowPrivateHosts?: boolean; timeoutMs?: number },
): Promise<ResolvedReferenceImage> {
  const label = input.label?.trim() || `참조 이미지 ${index + 1}`;
  const role: ReferenceImageRole = input.role ?? "product";

  let bytes: Buffer;
  let origin: string;
  let mimeType = input.mimeType?.trim().toLowerCase();

  if (input.url?.trim()) {
    const url = normalizeUrl(input.url);
    if (!options.allowPrivateHosts && isPrivateHost(url.hostname)) {
      throw new ReferenceImageError("사설망 주소는 참조 이미지로 쓸 수 없습니다.", input.url);
    }
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        accept: "image/*",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new ReferenceImageError(
        `내려받지 못했습니다(${error instanceof Error ? error.message : String(error)})`,
        input.url,
      );
    });

    if (!response.ok) throw new ReferenceImageError(`HTTP ${response.status}`, input.url);
    const declared = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (declared && !SUPPORTED_MIME.has(declared)) {
      throw new ReferenceImageError(`이미지가 아닙니다(${declared}).`, input.url);
    }
    bytes = await readLimited(response, options.maxBytes, input.url);
    mimeType = mimeType || declared || guessMime(undefined, url.pathname);
    origin = url.toString();
  } else if (input.path?.trim()) {
    const filePath = path.resolve(input.path.trim());
    bytes = await readFile(filePath).catch(() => {
      throw new ReferenceImageError("파일을 읽지 못했습니다.", input.path);
    });
    if (bytes.byteLength > options.maxBytes) {
      throw new ReferenceImageError(`파일이 너무 큽니다(${Math.round(bytes.byteLength / 1024 / 1024)}MB).`, input.path);
    }
    mimeType = mimeType || guessMime(bytes, filePath);
    origin = filePath;
  } else if (input.data?.trim()) {
    const decoded = decodeDataUrl(input.data.trim());
    bytes = decoded.bytes;
    if (bytes.byteLength > options.maxBytes) {
      throw new ReferenceImageError(`이미지가 너무 큽니다(${Math.round(bytes.byteLength / 1024 / 1024)}MB).`);
    }
    mimeType = mimeType || decoded.mimeType || guessMime(bytes);
    origin = "inline:base64";
  } else {
    throw new ReferenceImageError("url·path·data 중 하나가 필요합니다.");
  }

  if (bytes.byteLength === 0) throw new ReferenceImageError("빈 파일입니다.", origin);
  const finalMime = normalizeMime(mimeType || guessMime(bytes));
  if (!SUPPORTED_MIME.has(finalMime)) {
    throw new ReferenceImageError(`지원하지 않는 이미지 형식입니다(${finalMime}). PNG·JPEG·WebP만 씁니다.`, origin);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex").slice(0, 10);

  return {
    bytes,
    mimeType: finalMime === "image/jpg" ? "image/jpeg" : finalMime,
    filename: `reference-${String(index + 1).padStart(2, "0")}.${extensionFor(finalMime)}`,
    label,
    role,
    origin,
    sha256,
  };
}

/** 스토리보드 JSON에 실어 워커·재렌더에서도 같은 사진을 다시 쓸 수 있게 합니다. */
export function toStoryboardReferences(images: readonly ResolvedReferenceImage[]): StoryboardReference[] {
  return images.map((image) => ({
    ...(image.origin.startsWith("http") ? { url: image.origin } : {}),
    label: image.label,
    role: image.role,
    mimeType: image.mimeType,
  }));
}

/**
 * 아직 읽지 않은 입력(URL·경로·base64)에서 스토리보드용 표기를 만듭니다.
 * URL만 스토리보드에 실립니다(로컬 경로·base64는 그 작업 디렉터리에서만 의미가 있습니다).
 */
export function toStoryboardReferenceList(inputs: readonly ReferenceImage[] | undefined): StoryboardReference[] {
  return (inputs ?? []).map((input, index) => ({
    ...(input.url?.trim() ? { url: input.url.trim() } : {}),
    label: input.label?.trim() || `참조 이미지 ${index + 1}`,
    role: input.role ?? "product",
    ...(input.mimeType?.trim() ? { mimeType: input.mimeType.trim() } : {}),
  }));
}

/** `product` 역할 사진만 골라냅니다(제품 외관 고정 프롬프트 대상). */
export function productReferences(images: readonly { role: ReferenceImageRole }[]): { role: ReferenceImageRole }[] {
  return images.filter((image) => image.role === "product");
}

export function summarizeReferences(images: readonly ResolvedReferenceImage[]): { count: number; labels: string[]; roles: ReferenceImageRole[] } | undefined {
  if (images.length === 0) return undefined;
  return {
    count: images.length,
    labels: images.map((image) => image.label),
    roles: images.map((image) => image.role),
  };
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true;
  if (host === "[::1]" || host === "::1") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ReferenceImageError("http(s) 주소만 참조 이미지로 쓸 수 있습니다.", input);
  }
  try {
    return new URL(trimmed);
  } catch {
    throw new ReferenceImageError("주소 형식이 올바르지 않습니다.", input);
  }
}

async function readLimited(response: Response, maxBytes: number, origin: string): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new ReferenceImageError(`이미지가 너무 큽니다(${Math.round(declared / 1024 / 1024)}MB).`, origin);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new ReferenceImageError(`이미지가 너무 큽니다(${Math.round(buffer.byteLength / 1024 / 1024)}MB).`, origin);
  }
  return buffer;
}

function decodeDataUrl(value: string): { bytes: Buffer; mimeType?: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(value);
  if (!match) {
    // 접두어 없는 순수 base64
    return { bytes: Buffer.from(value, "base64") };
  }
  const [, mime, base64, payload = ""] = match;
  const bytes = base64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  return { bytes, ...(mime ? { mimeType: mime } : {}) };
}

function guessMime(bytes: Buffer | undefined, name = ""): string {
  if (bytes && bytes.length >= 12) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes.subarray(0, 4).toString("ascii") === "RIFF") return "image/webp";
  }
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  return "application/octet-stream";
}

function normalizeMime(mime: string): string {
  const lower = mime.split(";")[0]?.trim().toLowerCase() || "";
  if (lower === "image/jpg") return "image/jpeg";
  if (lower === "image/pjpeg") return "image/jpeg";
  return lower;
}

function extensionFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}
