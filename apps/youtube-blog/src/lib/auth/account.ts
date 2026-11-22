import type { Store, User } from "@tae/db";

import { getRuntime, TRIAL_CREDITS } from "../runtime";
import { getSessionUser } from "../session";

import { setSessionCookie } from "./guard";

import type { OAuthProfile, OAuthProvider } from "./oauth";

/**
 * 로그인/회원가입 공통 마무리:
 *  - 이전 체험(게스트) 세션의 작업 기록을 새 계정으로 옮깁니다(크레딧은 옮기지 않음).
 *  - 신규 가입 보너스를 1회 지급합니다(이미 받았으면 그대로).
 *  - 세션 쿠키를 새 계정으로 교체합니다.
 */
export async function finishLogin(
  store: Store,
  user: User,
  options: { bonus?: boolean } = {},
): Promise<{ user: User; movedJobs: number }> {
  const previous = await getSessionUser().catch(() => null);
  let movedJobs = 0;
  if (previous && previous.id !== user.id) {
    movedJobs = await store.transferJobs(previous.id, user.id).catch(() => 0);
  }

  if (options.bonus !== false && TRIAL_CREDITS > 0) {
    await store.grantSignupBonus(user.id, TRIAL_CREDITS).catch(() => undefined);
  }

  await store.updateUser(user.id, { lastLoginAt: new Date().toISOString() }).catch(() => undefined);
  await setSessionCookie(user.id);

  return { user: { ...user, lastLoginAt: new Date().toISOString() }, movedJobs };
}

/**
 * 소셜 로그인 계정 해석:
 *  1) provider 계정 연결이 있으면 그 사용자
 *  2) 같은 이메일의 기존 계정이 있으면 연결(공급자가 이메일을 확인해 준 경우만)
 *  3) 없으면 새 회원 생성
 */
export async function resolveOAuthUser(
  store: Store,
  provider: OAuthProvider,
  profile: OAuthProfile,
): Promise<{ user: User; created: boolean; linked: boolean }> {
  const linkedAccount = await store.findOAuthAccount(provider, profile.providerUserId);
  if (linkedAccount) {
    const existing = await store.getUser(linkedAccount.userId);
    if (existing) {
      await store.upsertOAuthAccount({
        userId: existing.id,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        nickname: profile.nickname,
        raw: profile.raw,
      });
      return { user: existing, created: false, linked: false };
    }
  }

  if (profile.email) {
    const byEmail = await store.findUserByEmail(profile.email);
    if (byEmail) {
      await store.upsertOAuthAccount({
        userId: byEmail.id,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        nickname: profile.nickname,
        raw: profile.raw,
      });
      return { user: byEmail, created: false, linked: true };
    }
  }

  const created = await store.createUser({
    email: profile.email,
    displayName: profile.nickname,
    signupProvider: provider,
    emailVerifiedAt: profile.email ? new Date().toISOString() : null,
  });
  await store.upsertOAuthAccount({
    userId: created.id,
    provider,
    providerUserId: profile.providerUserId,
    email: profile.email,
    nickname: profile.nickname,
    raw: profile.raw,
  });
  return { user: created, created: true, linked: false };
}

/** 관리자 대시보드용 "가입 방식" 표기 */
export function providerLabel(provider: User["signupProvider"]): string {
  switch (provider) {
    case "naver":
      return "네이버";
    case "kakao":
      return "카카오";
    case "email":
      return "이메일";
    default:
      return "체험";
  }
}

export function runtimeStore(): Store {
  return getRuntime().store;
}
