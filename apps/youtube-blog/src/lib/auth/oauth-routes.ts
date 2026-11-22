import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { finishLogin, resolveOAuthUser } from "./account";
import {
  buildAuthorizeUrl,
  callbackUrl,
  createOAuthState,
  exchangeCode,
  fetchOAuthProfile,
  isOAuthConfigured,
  oauthConfig,
  oauthProviderLabel,
  resolveAppUrl,
  safeNextPath,
  type OAuthProvider,
} from "./oauth";
import { getRuntime } from "../runtime";

const STATE_MAX_AGE = 10 * 60;
const SECURE = process.env.NODE_ENV === "production";

function stateCookie(provider: OAuthProvider): string {
  return `tae_oauth_state_${provider}`;
}

function loginError(request: Request, code: string, detail?: string): NextResponse {
  const url = new URL("/login", resolveAppUrl(request));
  url.searchParams.set("error", code);
  if (detail) url.searchParams.set("detail", detail.slice(0, 120));
  return NextResponse.redirect(url, { status: 303 });
}

export { safeNextPath };

/** /api/auth/{provider} — 공급자 인증 화면으로 보냅니다. */
export async function startOAuth(request: Request, provider: OAuthProvider): Promise<NextResponse> {
  const config = oauthConfig(provider);
  if (!config) {
    return loginError(request, "oauth_not_configured", oauthProviderLabel(provider));
  }

  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const state = createOAuthState();

  const cookieStore = await cookies();
  cookieStore.set(stateCookie(provider), state, {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE,
    path: "/",
    maxAge: STATE_MAX_AGE,
  });
  cookieStore.set("tae_oauth_next", next, {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE,
    path: "/",
    maxAge: STATE_MAX_AGE,
  });

  const redirectUri = callbackUrl(resolveAppUrl(request), provider);
  return NextResponse.redirect(buildAuthorizeUrl(config, { redirectUri, state }), { status: 302 });
}

/** /api/auth/{provider}/callback — code 교환 → 회원 연결 → 세션 쿠키 */
export async function handleOAuthCallback(request: Request, provider: OAuthProvider): Promise<NextResponse> {
  const config = oauthConfig(provider);
  if (!config) {
    return loginError(request, "oauth_not_configured", oauthProviderLabel(provider));
  }

  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return loginError(request, "oauth_denied", oauthProviderLabel(provider));
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(stateCookie(provider))?.value ?? "";
  const next = safeNextPath(cookieStore.get("tae_oauth_next")?.value ?? null);

  cookieStore.delete(stateCookie(provider));
  cookieStore.delete("tae_oauth_next");

  if (!code || !state || !expectedState || !sameState(state, expectedState)) {
    return loginError(request, "oauth_state", oauthProviderLabel(provider));
  }

  try {
    const redirectUri = callbackUrl(resolveAppUrl(request), provider);
    const accessToken = await exchangeCode(config, { code, state, redirectUri });
    const profile = await fetchOAuthProfile(config, accessToken);

    const { store } = getRuntime();
    const resolved = await resolveOAuthUser(store, provider, profile);
    await finishLogin(store, resolved.user);

    const target = new URL(next, resolveAppUrl(request));
    return NextResponse.redirect(target, { status: 303 });
  } catch (error) {
    console.error(`[auth/${provider}] callback 실패`, error instanceof Error ? error.message : error);
    return loginError(request, "oauth_failed", oauthProviderLabel(provider));
  }
}

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function oauthConfigured(provider: OAuthProvider): boolean {
  return isOAuthConfigured(provider);
}
