import { cookies } from "next/headers";

import type { User } from "@tae/db";

import { AppError } from "../app-error";

import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, resolveSessionSecret, signSession } from "../session-token";

export interface SessionUserView {
  id: string;
  email: string | null;
  displayName: string | null;
  role: "user" | "admin";
  signupProvider: "email" | "naver" | "kakao" | "guest";
  hasPassword: boolean;
  isGuest: boolean;
  createdAt: string;
}

/** 브라우저에 내려도 되는 사용자 정보만 남깁니다. */
export function sessionUserView(user: User): SessionUserView {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    signupProvider: user.signupProvider,
    hasPassword: user.hasPassword,
    isGuest: user.signupProvider === "guest",
    createdAt: user.createdAt,
  };
}

export interface SessionWriteOptions {
  /** 로그인 만료를 30일로 짧게 할 때 사용 */
  maxAgeSeconds?: number;
}

/** 로그인 성공 시 서명 쿠키를 심습니다. Route Handler / Server Action에서만 호출하세요. */
export async function setSessionCookie(userId: string, options: SessionWriteOptions = {}): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signSession(userId, resolveSessionSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: options.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function requireUser(): Promise<User> {
  const user = await (await import("../session")).getSessionUser();
  if (!user) {
    throw new AppError("unauthenticated", "로그인이 필요합니다. 로그인하거나 회원가입해 주세요.", 401);
  }
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new AppError("forbidden", "관리자만 접근할 수 있습니다.", 403);
  }
  return user;
}

export function isAdmin(user: User | null | undefined): boolean {
  return user?.role === "admin";
}

/** 관리자 UI에서 특정 회원을 지목할 때 쓰는 최소 검증 */
export function isValidUserId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
