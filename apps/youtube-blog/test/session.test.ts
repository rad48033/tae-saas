import { describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  resolveSessionSecret,
  signSession,
  verifySession,
} from "../src/lib/session-token";

const SECRET = "test-secret-with-enough-length";
const USER_ID = "8f1f0f26-0a0b-4a2e-9c6e-3a7a1f2f1a11";

describe("session tokens", () => {
  it("round-trips a user id", () => {
    expect(verifySession(signSession(USER_ID, SECRET), SECRET)).toBe(USER_ID);
  });

  it("rejects tampered or foreign tokens", () => {
    const token = signSession(USER_ID, SECRET);
    expect(verifySession(token, "another-secret-entirely")).toBeNull();
    expect(verifySession(`${token}x`, SECRET)).toBeNull();
    expect(verifySession(token.replace(USER_ID, "0".repeat(USER_ID.length)), SECRET)).toBeNull();
    expect(verifySession("", SECRET)).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
    expect(verifySession("a.b.c", SECRET)).toBeNull();
  });

  it("expires old tokens", () => {
    const issuedAt = Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 10;
    expect(verifySession(signSession(USER_ID, SECRET, issuedAt), SECRET)).toBeNull();
    const fresh = Math.floor(Date.now() / 1000) - 60;
    expect(verifySession(signSession(USER_ID, SECRET, fresh), SECRET)).toBe(USER_ID);
  });
});

describe("resolveSessionSecret", () => {
  it("uses SESSION_SECRET when long enough", () => {
    expect(resolveSessionSecret({ SESSION_SECRET: SECRET })).toBe(SECRET);
  });

  it("falls back only outside production", () => {
    expect(resolveSessionSecret({ NODE_ENV: "development" })).toMatch(/dev-only/);
    expect(() => resolveSessionSecret({ NODE_ENV: "production" })).toThrowError(/SESSION_SECRET/);
    expect(() => resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: "short" })).toThrowError(/SESSION_SECRET/);
  });
});
