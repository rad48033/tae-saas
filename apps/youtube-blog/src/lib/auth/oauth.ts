import { randomBytes } from "node:crypto";

export type OAuthProvider = "naver" | "kakao";

export interface OAuthConfig {
  provider: OAuthProvider;
  label: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scope: string;
}

export interface OAuthProfile {
  providerUserId: string;
  email: string | null;
  nickname: string | null;
  raw: Record<string, unknown>;
}

const DEFS: Record<
  OAuthProvider,
  { label: string; authorizeUrl: string; tokenUrl: string; profileUrl: string; scope: string; idEnv: string; secretEnv: string }
> = {
  naver: {
    label: "네이버",
    authorizeUrl: "https://nid.naver.com/oauth2.0/authorize",
    tokenUrl: "https://nid.naver.com/oauth2.0/token",
    profileUrl: "https://openapi.naver.com/v1/nid/me",
    scope: "",
    idEnv: "NAVER_CLIENT_ID",
    secretEnv: "NAVER_CLIENT_SECRET",
  },
  kakao: {
    label: "카카오",
    authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    profileUrl: "https://kapi.kakao.com/v2/user/me",
    // 비즈앱 전환 전에는 이메일 동의항목이 없어 닉네임만 요청합니다.
    scope: "profile_nickname",
    idEnv: "KAKAO_CLIENT_ID",
    secretEnv: "KAKAO_CLIENT_SECRET",
  },
};

export function oauthProviderLabel(provider: OAuthProvider): string {
  return DEFS[provider].label;
}

/** 키가 없으면 null. 앱은 이 경우 친절한 안내만 보여 주고 크래시하지 않습니다. */
export function oauthConfig(
  provider: OAuthProvider,
  env: Record<string, string | undefined> = process.env,
): OAuthConfig | null {
  const def = DEFS[provider];
  const clientId = env[def.idEnv]?.trim();
  const clientSecret = env[def.secretEnv]?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    provider,
    label: def.label,
    clientId,
    clientSecret,
    authorizeUrl: def.authorizeUrl,
    tokenUrl: def.tokenUrl,
    profileUrl: def.profileUrl,
    scope: def.scope,
  };
}

export function isOAuthConfigured(
  provider: OAuthProvider,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return oauthConfig(provider, env) !== null;
}

/** 로그인 시작 URL. 네이버는 scope 파라미터를 쓰지 않습니다. */
export function buildAuthorizeUrl(
  config: OAuthConfig,
  input: { redirectUri: string; state: string },
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  if (config.scope) url.searchParams.set("scope", config.scope);
  return url.toString();
}

export function createOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

/** 콜백 주소. NEXT_PUBLIC_APP_URL이 있으면 그것을, 없으면 요청 origin을 씁니다. */
export function resolveAppUrl(request: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured && /^https?:\/\//i.test(configured)) return configured;

  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || url.host;
  const proto = forwardedProto || url.protocol.replace(":", "") || "https";
  return `${proto}://${host}`;
}

export function callbackUrl(appUrl: string, provider: OAuthProvider): string {
  return `${appUrl.replace(/\/$/, "")}/api/auth/${provider}/callback`;
}

/** 로그인 후 돌아갈 경로. 외부 도메인·API 경로로는 보내지 않습니다. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/api/")) return "/";
  return value.slice(0, 500);
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  error_code?: string;
  msg?: string;
}

export async function exchangeCode(
  config: OAuthConfig,
  input: { code: string; state: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  if (config.provider === "naver") body.set("state", input.state);

  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      accept: "application/json",
    },
    body: body.toString(),
  });

  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !data.access_token) {
    const reason = data.error_description || data.error || data.msg || `HTTP ${response.status}`;
    throw new Error(`${config.label} 토큰 교환 실패: ${String(reason).slice(0, 200)}`);
  }
  return data.access_token;
}

export async function fetchOAuthProfile(
  config: OAuthConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthProfile> {
  const response = await fetchImpl(config.profileUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${config.label} 프로필 조회 실패: HTTP ${response.status}`);
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return parseOAuthProfile(config.provider, json);
}

/** 공급자 응답 → 공통 프로필. 네트워크 없이 테스트할 수 있게 분리했습니다. */
export function parseOAuthProfile(provider: OAuthProvider, json: Record<string, unknown>): OAuthProfile {
  if (provider === "naver") {
    const response = (json.response ?? {}) as Record<string, unknown>;
    const id = response.id;
    if (typeof id !== "string" && typeof id !== "number") {
      throw new Error("네이버 응답에 사용자 id가 없습니다.");
    }
    const email = typeof response.email === "string" && response.email.includes("@") ? response.email : null;
    const nickname =
      (typeof response.nickname === "string" && response.nickname) ||
      (typeof response.name === "string" && response.name) ||
      null;
    return { providerUserId: String(id), email, nickname, raw: json };
  }

  const id = json.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("카카오 응답에 사용자 id가 없습니다.");
  }
  const account = (json.kakao_account ?? {}) as Record<string, unknown>;
  const profile = (account.profile ?? {}) as Record<string, unknown>;
  const email =
    typeof account.email === "string" && account.email.includes("@") ? account.email : null;
  const nickname = typeof profile.nickname === "string" && profile.nickname ? profile.nickname : null;
  return { providerUserId: String(id), email, nickname, raw: json };
}
