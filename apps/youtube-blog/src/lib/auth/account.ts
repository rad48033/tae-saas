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
 *  1) provider + provider_user_id(회원번호) 연결이 있으면 그 사용자
 *  2) 없으면 새 회원 생성(이메일은 없을 수 있음)
 *
 * 이메일로 기존 계정을 합치지 않는 이유: 카카오는 비즈앱 전환 전 이메일을 주지 않고,
 * 네이버가 주는 이메일도 고유값이 아니어서 다른 사람의 계정에 붙을 위험이 있습니다.
 * 신원은 항상 provider + provider_user_id로만 판단합니다.
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
