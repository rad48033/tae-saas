import { createHash, randomBytes } from "node:crypto";

/**
 * 비밀번호 재설정 토큰.
 *
 * 원문 토큰은 메일로 나가는 링크에만 들어가고, 서버(DB)에는 sha256 해시만 남깁니다.
 * 링크가 길게 유출돼도 DB를 읽는 것만으로는 재설정할 수 없습니다.
 */
export const RESET_TOKEN_BYTES = 32;
/** 링크 유효 시간(분). 짧을수록 안전하지만 메일 확인 시간을 고려해 60분으로 둡니다. */
export const RESET_TTL_MINUTES = 60;

export function createResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(RESET_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

export function resetExpiresAt(now: number = Date.now()): string {
  return new Date(now + RESET_TTL_MINUTES * 60 * 1000).toISOString();
}

/** 재설정 링크. APP_URL(또는 요청 오리진)을 기준으로 만듭니다. */
export function resetUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * 메일에 넣을 링크의 기준 주소.
 *  - APP_URL / NEXT_PUBLIC_APP_URL 이 있으면 그 값(프록시 뒤에서도 정확)
 *  - 없으면 요청의 오리진(로컬 개발)
 */
export function appOrigin(request?: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = env.APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (request) {
    try {
      const url = new URL(request.url);
      return url.origin;
    } catch {
      // 무시하고 아래 기본값으로
    }
  }
  return "http://localhost:3000";
}

/** 토큰 모양 사전 검증(불필요한 DB 조회를 줄입니다). */
export function looksLikeResetToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(value.trim());
}
