import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "tae_uid";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const MAX_AGE_TOLERANCE_SECONDS = 60;

export function signSession(userId: string, secret: string, issuedAt = Math.floor(Date.now() / 1000)): string {
  const payload = `${userId}.${issuedAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * 서명·만료를 확인하고 userId와 발급 시각을 돌려줍니다. 잘못된 토큰은 null.
 * 발급 시각은 "비밀번호를 바꾼 뒤 예전 쿠키"를 걸러내는 데 씁니다(session.ts).
 */
export function verifySessionPayload(
  token: string | undefined | null,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): { userId: string; issuedAt: number } | null {
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

  return { userId, issuedAt };
}

/** 서명·만료를 확인하고 userId를 돌려줍니다. 잘못된 토큰은 null. */
export function verifySession(
  token: string | undefined | null,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): string | null {
  return verifySessionPayload(token, secret, now)?.userId ?? null;
}

/**
 * 세션 발급 시각이 비밀번호 변경 시각보다 이전이면 무효(비밀번호를 바꾸면 예전 기기가 로그아웃).
 * 5초 여유를 두어 "재설정 직후 로그인"이 같은 초에 걸려 풀리지 않는 일을 막습니다.
 */
export function isSessionFresh(user: { passwordChangedAt?: string | null }, issuedAt: number): boolean {
  if (!user.passwordChangedAt) return true;
  const changed = Math.floor(Date.parse(user.passwordChangedAt) / 1000);
  if (!Number.isFinite(changed)) return true;
  return issuedAt >= changed - 5;
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
