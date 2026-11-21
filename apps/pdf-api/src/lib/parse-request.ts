import { z } from "zod";

import { isPdfStructureSchemaId, type PdfStructureSchemaId } from "@tae/ai";

import { ApiError } from "./errors";

export type ConversionMode = "text" | "structured";

export interface ConversionOptions {
  mode: ConversionMode;
  schema: PdfStructureSchemaId;
  language?: string;
  instructions?: string;
}

export interface ParsedConversionRequest {
  bytes?: Uint8Array;
  url?: string;
  sourceName: string;
  options: ConversionOptions;
}

const optionSchema = z.object({
  mode: z.enum(["text", "structured"]).default("structured"),
  schema: z.string().default("generic"),
  language: z.string().max(20).optional(),
  instructions: z.string().max(2000).optional(),
});

const jsonBodySchema = z.object({
  url: z.string().url().optional(),
  base64: z.string().optional(),
  fileName: z.string().max(200).optional(),
  mode: z.enum(["text", "structured"]).optional(),
  schema: z.string().optional(),
  language: z.string().max(20).optional(),
  instructions: z.string().max(2000).optional(),
});

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * multipart 파일 업로드 / JSON(base64, URL) / raw PDF 바디를 모두 같은 형태로 정규화합니다.
 */
export async function parseConversionRequest(
  request: Request,
  config: { maxUploadBytes: number },
): Promise<ParsedConversionRequest> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    return parseMultipart(request, config);
  }

  if (contentType.includes("application/json")) {
    return parseJson(request, config);
  }

  if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream")) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    assertSize(bytes, config.maxUploadBytes);
    const options = normalizeOptions({});
    return { bytes, sourceName: request.headers.get("x-filename") ?? "upload.pdf", options };
  }

  throw new ApiError(
    "unsupported_media_type",
    "multipart/form-data(PDF 파일), application/json(URL 또는 base64), application/pdf 중 하나로 보내주세요.",
    415,
  );
}

async function parseMultipart(
  request: Request,
  config: { maxUploadBytes: number },
): Promise<ParsedConversionRequest> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError("invalid_request", "multipart 본문을 해석하지 못했습니다.", 400);
  }

  const file = form.get("file") ?? form.get("pdf");
  if (!(file instanceof File)) {
    throw new ApiError("invalid_request", "`file` 필드에 PDF 파일을 첨부해 주세요.", 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  assertSize(bytes, config.maxUploadBytes);
  assertPdfMagic(bytes);

  const options = normalizeOptions({
    mode: typeof form.get("mode") === "string" ? form.get("mode") : undefined,
    schema: typeof form.get("schema") === "string" ? form.get("schema") : undefined,
    language: typeof form.get("language") === "string" ? form.get("language") : undefined,
    instructions: typeof form.get("instructions") === "string" ? form.get("instructions") : undefined,
  });

  return { bytes, sourceName: file.name || "upload.pdf", options };
}

async function parseJson(
  request: Request,
  config: { maxUploadBytes: number },
): Promise<ParsedConversionRequest> {
  const raw = await request.json().catch(() => {
    throw new ApiError("invalid_request", "JSON 본문을 해석하지 못했습니다.", 400);
  });

  const parsed = jsonBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_request", "요청 형식이 올바르지 않습니다.", 400, parsed.error.issues);
  }

  const body = parsed.data;
  if (!body.url && !body.base64) {
    throw new ApiError("invalid_request", "`url` 또는 `base64` 중 하나는 필요합니다.", 400);
  }
  if (body.url && body.base64) {
    throw new ApiError("invalid_request", "`url`과 `base64`는 동시에 보낼 수 없습니다.", 400);
  }

  const options = normalizeOptions(body);

  if (body.base64) {
    const cleaned = body.base64.replace(/^data:application\/pdf;base64,/, "").replace(/\s+/g, "");
    const bytes = Buffer.from(cleaned, "base64");
    assertSize(bytes, config.maxUploadBytes);
    assertPdfMagic(bytes);
    return { bytes: new Uint8Array(bytes), sourceName: body.fileName ?? "upload.pdf", options };
  }

  return { url: body.url, sourceName: body.fileName ?? body.url ?? "remote.pdf", options };
}

export function normalizeOptions(input: {
  mode?: unknown;
  schema?: unknown;
  language?: unknown;
  instructions?: unknown;
}): ConversionOptions {
  const candidate = optionSchema.safeParse({
    mode: input.mode ?? undefined,
    schema: input.schema ?? undefined,
    language: input.language ?? undefined,
    instructions: input.instructions ?? undefined,
  });

  if (!candidate.success) {
    throw new ApiError("invalid_request", "변환 옵션이 올바르지 않습니다.", 400, candidate.error.issues);
  }

  const { mode, schema, language, instructions } = candidate.data;
  if (!isPdfStructureSchemaId(schema)) {
    throw new ApiError(
      "invalid_request",
      `지원하지 않는 schema입니다: ${schema}`,
      400,
      { supported: ["generic", "invoice", "receipt", "resume", "contract"] },
    );
  }

  return {
    mode,
    schema: mode === "text" ? "generic" : schema,
    ...(language ? { language } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

/** 외부 URL에서 PDF를 받아옵니다. 사설망 접근(SSRF)을 차단합니다. */
export async function fetchPdfFromUrl(
  rawUrl: string,
  options: { maxBytes: number; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const url = assertPublicHttpUrl(rawUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(url.toString(), {
    headers: { Accept: "application/pdf,*/*;q=0.8", "User-Agent": "tae-pdf-api/0.1" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    redirect: "follow",
  }).catch((error: unknown) => {
    throw new ApiError("invalid_request", "URL에서 파일을 받아오지 못했습니다.", 422, {
      reason: error instanceof Error ? error.message : String(error),
    });
  });

  if (!response.ok) {
    throw new ApiError("invalid_request", `URL 응답이 ${response.status}입니다.`, 422);
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > options.maxBytes) {
    throw new ApiError("payload_too_large", "파일이 허용 크기를 넘습니다.", 413);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  assertSize(bytes, options.maxBytes);
  assertPdfMagic(bytes);

  const fileName = decodeURIComponent(new URL(url.toString()).pathname.split("/").pop() || "remote.pdf");
  return { bytes, fileName };
}

export function assertSize(bytes: Uint8Array, maxBytes: number): void {
  if (bytes.byteLength > maxBytes) {
    throw new ApiError(
      "payload_too_large",
      `파일이 너무 큽니다. 최대 ${Math.floor(maxBytes / 1024 / 1024)}MB까지 지원합니다.`,
      413,
      { maxBytes, size: bytes.byteLength },
    );
  }
  if (bytes.byteLength === 0) {
    throw new ApiError("invalid_request", "빈 파일입니다.", 400);
  }
}

export function assertPdfMagic(bytes: Uint8Array): void {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (!head.includes("%PDF")) {
    throw new ApiError("unsupported_media_type", "PDF 파일로 보이지 않습니다(%PDF 헤더 없음).", 415);
  }
}

/** http(s) + 공인 호스트만 허용합니다. 사설 IP·로컬 호스트는 차단합니다. */
export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ApiError("invalid_request", "올바른 URL이 아닙니다.", 400);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError("invalid_request", "http(s) URL만 지원합니다.", 400);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isPrivateIpv4(hostname) ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80")
  ) {
    throw new ApiError("invalid_request", "사설망 주소로는 접근할 수 없습니다.", 400);
  }

  return url;
}

function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}
