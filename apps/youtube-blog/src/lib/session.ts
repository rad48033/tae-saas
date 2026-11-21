import { cookies } from "next/headers";

import type { User } from "@tae/db";

import { AppError } from "./app-error";
import { getRuntime, TRIAL_CREDITS } from "./runtime";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  resolveSessionSecret,
  signSession,
  verifySession,
} from "./session-token";

export interface SessionState {
  user: User;
  created: boolean;
}

/**
 * 쿠키의 서명된 userId로 사용자를 찾고, 없으면 익명 사용자를 만들어
 * 체험 크레딧을 1회 지급합니다. Route Handler / Server Action에서만 호출하세요.
 */
export async function ensureUser(): Promise<SessionState> {
  const cookieStore = await cookies();
  const secret = sessionSecretOrThrow();
  const { store } = getRuntime();

  const existingId = verifySession(cookieStore.get(SESSION_COOKIE)?.value, secret);
  if (existingId) {
    const existing = await store.getUser(existingId);
    if (existing) return { user: existing, created: false };
  }

  const user = await store.createUser();
  cookieStore.set(SESSION_COOKIE, signSession(user.id, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  if (TRIAL_CREDITS > 0) {
    await store.grantSignupBonus(user.id, TRIAL_CREDITS);
  }

  return { user, created: true };
}

/** 읽기 전용 조회(세션 쿠키를 새로 쓰지 않습니다). */
export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get(SESSION_COOKIE)?.value, sessionSecretOrThrow());
  if (!userId) return null;
  return getRuntime().store.getUser(userId);
}

function sessionSecretOrThrow(): string {
  try {
    return resolveSessionSecret();
  } catch {
    throw new AppError(
      "internal_error",
      "서버 설정 오류: SESSION_SECRET이 없어 세션을 만들 수 없습니다. 배포 환경변수를 확인해 주세요.",
      503,
    );
  }
}
