import { randomUUID } from "node:crypto";

/**
 * 영상 파일 업로드 저장소(Supabase Storage).
 *
 * Vercel 함수는 요청 본문이 4.5MB로 제한돼 있어, 영상 파일은 브라우저가 Storage로 직접
 * 올리고(signed upload URL) 서버는 그 객체만 내려받아 전사합니다.
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 가 없으면 업로드 기능만 꺼집니다(다른 경로는 정상).
 */
export const UPLOAD_BUCKET = "video-uploads";
/** OpenAI Whisper의 파일 상한(25MB)보다 조금 작게 잡습니다. */
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
/** 서명 URL 유효 시간(초) */
const SIGN_TTL_SECONDS = 15 * 60;

export interface StorageStatus {
  configured: boolean;
  reason: string | null;
}

export interface SignedUpload {
  /** 브라우저가 PUT할 전체 주소(토큰 포함) */
  uploadUrl: string;
  /** 서버가 나중에 찾을 객체 경로(<userId>/<uuid>.<ext>) */
  path: string;
  expiresInSeconds: number;
}

interface SupabaseConfig {
  url: string;
  key: string;
}

function config(env: Record<string, string | undefined> = process.env): SupabaseConfig | null {
  const url = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return { url, key };
}

export function storageStatus(env: Record<string, string | undefined> = process.env): StorageStatus {
  if (config(env)) return { configured: true, reason: null };
  return {
    configured: false,
    reason:
      "SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 없어 영상 파일 업로드를 쓸 수 없습니다. 캡션·대본 붙여넣기로 계속 만들 수 있습니다.",
  };
}

/** 브라우저가 보낸 파일 정보를 검사합니다(형식·크기). */
export function checkUpload(input: { filename: string; mimeType: string; size: number }): { ext: string; mime: string } | null {
  const mime = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = (input.filename.split(".").pop() ?? "").toLowerCase();

  const allowed: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-m4v": "m4v",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "weba",
    "audio/ogg": "ogg",
  };

  if (mime && allowed[mime]) return { ext: allowed[mime], mime };
  // 브라우저가 형식을 비워 보내는 경우(일부 안드로이드) 확장자로 판단
  const byExt: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    webm: "video/webm",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
  };
  if (byExt[ext]) return { ext, mime: byExt[ext]! };
  return null;
}

/**
 * 브라우저가 직접 올릴 수 있는 서명 URL을 만듭니다.
 * 버킷이 없으면 한 번 만들어 둡니다(멱등).
 */
export async function createSignedUpload(
  userId: string,
  input: { ext: string; mime: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SignedUpload> {
  const cfg = config();
  if (!cfg) throw new Error("storage_not_configured");

  await ensureBucket(cfg, fetchImpl);

  const path = `${userId}/${randomUUID()}.${input.ext}`;
  const response = await fetchImpl(`${cfg.url}/storage/v1/object/upload/sign/${UPLOAD_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });

  const payload = (await response.json().catch(() => null)) as { url?: string; message?: string } | null;
  if (!response.ok || !payload?.url) {
    throw new Error(`storage_sign_failed: ${payload?.message ?? response.status}`);
  }

  const relative = payload.url.startsWith("/") ? payload.url : `/${payload.url}`;
  return {
    uploadUrl: `${cfg.url}/storage/v1${relative}`,
    path,
    expiresInSeconds: SIGN_TTL_SECONDS,
  };
}

async function ensureBucket(cfg: SupabaseConfig, fetchImpl: typeof fetch): Promise<void> {
  const headers = {
    apikey: cfg.key,
    authorization: `Bearer ${cfg.key}`,
    "content-type": "application/json",
  };
  // 이미 있으면 400/409가 오므로 무시합니다.
  await fetchImpl(`${cfg.url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: UPLOAD_BUCKET,
      name: UPLOAD_BUCKET,
      public: false,
      file_size_limit: 50 * 1024 * 1024,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/** 업로드된 객체를 내려받습니다(서버 전용). */
export async function downloadObject(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ body: Buffer; contentType: string; size: number } | null> {
  const cfg = config();
  if (!cfg) return null;

  const response = await fetchImpl(`${cfg.url}/storage/v1/object/authenticated/${UPLOAD_BUCKET}/${encodeURI(path)}`, {
    headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    body: buffer,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    size: buffer.byteLength,
  };
}

export async function removeObject(path: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  await fetchImpl(`${cfg.url}/storage/v1/object/${UPLOAD_BUCKET}/${encodeURI(path)}`, {
    method: "DELETE",
    headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/** 경로가 이 사용자의 것인지 확인(<userId>/...) — 다른 사람 객체 접근을 막습니다. */
export function isOwnUploadPath(path: string, userId: string): boolean {
  if (!path.startsWith(`${userId}/`)) return false;
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(path);
}
