import { describe, expect, it } from "vitest";

import {
  dummyPasswordHash,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  passwordProblem,
  verifyPassword,
} from "../src/lib/auth/password";

import {
  buildAuthorizeUrl,
  callbackUrl,
  oauthConfig,
  parseOAuthProfile,
  resolveAppUrl,
  safeNextPath,
  exchangeCode,
} from "../src/lib/auth/oauth";

import { SESSION_MAX_AGE_SECONDS, resolveSessionSecret, signSession, verifySession } from "../src/lib/session-token";

const SECRET = "test-secret-with-enough-length";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored.split("$")).toHaveLength(6);
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("wrong password", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("produces a different salt for the same password", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });

  it("handles missing or malformed hashes without throwing", () => {
    expect(verifyPassword("x", null)).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "bcrypt$whatever")).toBe(false);
    expect(verifyPassword("x", "scrypt$abc$def")).toBe(false);
    expect(verifyPassword("x", dummyPasswordHash())).toBe(false);
  });

  it("validates password strength and email", () => {
    expect(passwordProblem("short")).toMatch(/8자/);
    expect(passwordProblem("long-enough")).toBeNull();
    expect(passwordProblem("        ")).toMatch(/공백/);
    expect(passwordProblem("a".repeat(129))).toMatch(/128자/);
    expect(isValidEmail("rad48033@gmail.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(normalizeEmail("  Rad48033@Gmail.COM ")).toBe("rad48033@gmail.com");
  });
});

describe("session secret", () => {
  it("prefers AUTH_SESSION_SECRET over SESSION_SECRET", () => {
    expect(resolveSessionSecret({ AUTH_SESSION_SECRET: SECRET, SESSION_SECRET: "another-long-secret-value" })).toBe(SECRET);
    expect(resolveSessionSecret({ SESSION_SECRET: SECRET })).toBe(SECRET);
  });

  it("requires a configured secret in production", () => {
    expect(() => resolveSessionSecret({ NODE_ENV: "production" })).toThrowError(/AUTH_SESSION_SECRET/);
  });

  it("keeps existing session tokens valid", () => {
    expect(verifySession(signSession("user-1", SECRET), SECRET, Math.floor(Date.now() / 1000) + 10)).toBe("user-1");
    expect(SESSION_MAX_AGE_SECONDS).toBeGreaterThan(60 * 60);
  });
});

describe("oauth config", () => {
  const env = {
    NAVER_CLIENT_ID: "naver-id",
    NAVER_CLIENT_SECRET: "naver-secret",
    KAKAO_CLIENT_ID: "kakao-id",
    KAKAO_CLIENT_SECRET: "kakao-secret",
  };

  it("returns null when keys are missing (앱이 크래시하지 않아야 함)", () => {
    expect(oauthConfig("naver", {})).toBeNull();
    expect(oauthConfig("kakao", { KAKAO_CLIENT_ID: "only-id" })).toBeNull();
  });

  it("builds authorize urls with state and callback", () => {
    const naver = oauthConfig("naver", env)!;
    const url = new URL(buildAuthorizeUrl(naver, { redirectUri: "https://taest.info/api/auth/naver/callback", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://nid.naver.com/oauth2.0/authorize");
    expect(url.searchParams.get("client_id")).toBe("naver-id");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toBeNull();

    const kakao = oauthConfig("kakao", env)!;
    const kakaoUrl = new URL(buildAuthorizeUrl(kakao, { redirectUri: "https://taest.info/api/auth/kakao/callback", state: "st" }));
    expect(kakaoUrl.origin + kakaoUrl.pathname).toBe("https://kauth.kakao.com/oauth/authorize");
    expect(kakaoUrl.searchParams.get("scope")).toBe("profile_nickname");
    expect(kakaoUrl.searchParams.get("client_secret")).toBeNull();
    expect(callbackUrl("https://taest.info/", "kakao")).toBe("https://taest.info/api/auth/kakao/callback");
  });

  it("falls back to the request origin and app url env", () => {
    const request = new Request("http://localhost:3000/api/auth/naver", { headers: { host: "localhost:3000" } });
    expect(resolveAppUrl(request, {})).toBe("http://localhost:3000");
    expect(resolveAppUrl(request, { NEXT_PUBLIC_APP_URL: "https://taest.info/" })).toBe("https://taest.info");
  });

  it("parses naver and kakao profiles", () => {
    expect(
      parseOAuthProfile("naver", { response: { id: "abc", email: "a@b.co", nickname: "원균" } }),
    ).toMatchObject({ providerUserId: "abc", email: "a@b.co", nickname: "원균" });

    expect(
      parseOAuthProfile("kakao", {
        id: 12345,
        kakao_account: { email: "c@d.co", profile: { nickname: "tae" } },
      }),
    ).toMatchObject({ providerUserId: "12345", email: "c@d.co", nickname: "tae" });

    expect(parseOAuthProfile("naver", { response: { id: "x" } }).email).toBeNull();
    expect(() => parseOAuthProfile("kakao", {})).toThrowError(/id/);
  });

  it("exchanges a code with the provider form body", async () => {
    const config = oauthConfig("kakao", env)!;
    let seen: { url: string; body: string } | null = null;
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(input), body: String(init?.body ?? "") };
      return new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(exchangeCode(config, { code: "c", state: "s", redirectUri: "https://taest.info/cb" }, fakeFetch)).resolves.toBe(
      "token-1",
    );
    expect(seen!.url).toBe("https://kauth.kakao.com/oauth/token");
    expect(seen!.body).toContain("grant_type=authorization_code");
    expect(seen!.body).toContain("client_secret=kakao-secret");
  });

  it("sends naver state and surfaces provider errors", async () => {
    const config = oauthConfig("naver", env)!;
    function fakeFetch(body: unknown, ok = true): typeof fetch {
      return (async (_input: string | URL | Request, init?: RequestInit) => {
        expect(String(init?.body)).toContain("state=s1");
        return new Response(JSON.stringify(body), { status: ok ? 200 : 400 });
      }) as unknown as typeof fetch;
    }

    await expect(
      exchangeCode(config, { code: "c", state: "s1", redirectUri: "https://x/cb" }, fakeFetch({ access_token: "t" })),
    ).resolves.toBe("t");

    await expect(
      exchangeCode(config, { code: "c", state: "s1", redirectUri: "https://x/cb" }, fakeFetch({ error: "invalid_request" }, false)),
    ).rejects.toThrowError(/invalid_request/);
  });

  it("only allows internal next paths", () => {
    expect(safeNextPath("/admin")).toBe("/admin");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("/api/auth/logout")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
