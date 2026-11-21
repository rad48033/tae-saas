import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const API_KEY_PREFIX = "tae_live_";
const SECRET_BYTES = 24;

export interface GeneratedApiKey {
  /** 사용자에게 한 번만 보여주는 평문 키 */
  secret: string;
  /** DB에 저장하는 SHA-256 해시(hex) */
  hash: string;
  /** 목록 화면에 보여줄 마스킹된 접두사 */
  prefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = `${API_KEY_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return { secret, hash: hashApiKey(secret), prefix: `${secret.slice(0, API_KEY_PREFIX.length + 6)}…` };
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** 해시 비교가 필요한 경우(예: 테스트) 사용하는 상수 시간 비교 */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
