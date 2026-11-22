import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "tae_uid";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const MAX_AGE_TOLERANCE_SECONDS = 60;

export function signSession(userId: string, secret: string, issuedAt = Math.floor(Date.now() / 1000)): string {
  const payload = `${userId}.${issuedAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** 서명·만료를 확인하고 userId를 돌려줍니다. 잘못된 토큰은 null. */
export function verifySession(
  token: string | undefined | null,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): string | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [userId, issuedAtRaw, signature] = parts;
  if (!userId || !issuedAtRaw || !signature) return null;

  const expected = createHmac("sha256", secret).update(`${userId}.${issuedAtRaw}`).digest("base64url");
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (provided.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(provided, expectedBuffer)) return null;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return null;

  const age = now - issuedAt;
  if (age < -MAX_AGE_TOLERANCE_SECONDS || age > SESSION_MAX_AGE_SECONDS) return null;

  return userId;
}

/** 프로덕션에서는 반드시 AUTH_SESSION_SECRET(또는 SESSION_SECRET)이 있어야 합니다. */
export function resolveSessionSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.AUTH_SESSION_SECRET?.trim() || env.SESSION_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error("AUTH_SESSION_SECRET(또는 SESSION_SECRET)이 필요합니다. openssl rand -hex 32 로 생성해 설정하세요.");
  }
  return "dev-only-insecure-session-secret-change-me";
}
