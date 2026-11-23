import { describe, expect, it } from "vitest";

import { MemoryStore } from "@tae/db";

import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import {
  RESET_TTL_MINUTES,
  appOrigin,
  createResetToken,
  hashResetToken,
  looksLikeResetToken,
  resetExpiresAt,
  resetUrl,
} from "../src/lib/auth/reset";
import { isSessionFresh } from "../src/lib/session-token";

describe("reset token helpers", () => {
  it("creates an unguessable token and stores only its hash", () => {
    const { token, tokenHash } = createResetToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(looksLikeResetToken(token)).toBe(true);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashResetToken(token));
    expect(tokenHash).not.toContain(token);
    expect(createResetToken().token).not.toBe(token);
  });

  it("rejects malformed tokens before touching the database", () => {
    expect(looksLikeResetToken("short")).toBe(false);
    expect(looksLikeResetToken("has space in it and is long enough to pass length checks")).toBe(false);
  });

  it("expires after the configured window", () => {
    const now = Date.parse("2026-11-24T00:00:00.000Z");
    expect(resetExpiresAt(now)).toBe(new Date(now + RESET_TTL_MINUTES * 60_000).toISOString());
  });

  it("builds the reset link from APP_URL when configured", () => {
    expect(resetUrl("https://taest.info/", "abc")).toBe("https://taest.info/reset-password?token=abc");
    const request = new Request("http://localhost:3000/api/auth/forgot-password");
    expect(appOrigin(request, {})).toBe("http://localhost:3000");
    expect(appOrigin(request, { APP_URL: "https://taest.info/" })).toBe("https://taest.info");
  });
});

describe("password reset store", () => {
  async function seed() {
    const store = new MemoryStore();
    const user = await store.createUser({
      email: "member@example.com",
      displayName: "회원",
      passwordHash: hashPassword("old-password-1"),
      signupProvider: "email",
    });
    return { store, user };
  }

  it("consumes a reset token exactly once", async () => {
    const { store, user } = await seed();
    const { token, tokenHash } = createResetToken();
    await store.createPasswordReset({
      userId: user.id,
      tokenHash,
      expiresAt: resetExpiresAt(),
      delivery: "admin",
      requestedIp: "1.2.3.4",
    });

    const first = await store.consumePasswordReset(hashResetToken(token));
    expect(first?.userId).toBe(user.id);
    expect(first?.delivery).toBe("admin");
    const second = await store.consumePasswordReset(hashResetToken(token));
    expect(second).toBeNull();
  });

  it("refuses expired tokens", async () => {
    const { store, user } = await seed();
    const { token, tokenHash } = createResetToken();
    await store.createPasswordReset({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      delivery: "email",
    });
    expect(await store.consumePasswordReset(hashResetToken(token))).toBeNull();
    expect(await store.listPendingPasswordResets()).toEqual([]);
  });

  it("invalidates older links when a new one is issued or the password changes", async () => {
    const { store, user } = await seed();
    const first = createResetToken();
    const second = createResetToken();
    await store.createPasswordReset({ userId: user.id, tokenHash: first.tokenHash, expiresAt: resetExpiresAt(), delivery: "admin" });
    await store.createPasswordReset({ userId: user.id, tokenHash: second.tokenHash, expiresAt: resetExpiresAt(), delivery: "admin" });

    expect(await store.invalidatePasswordResets(user.id)).toBe(2);
    expect(await store.consumePasswordReset(first.tokenHash)).toBeNull();
    expect(await store.consumePasswordReset(second.tokenHash)).toBeNull();
  });

  it("lists pending requests with the member details for the admin screen", async () => {
    const { store, user } = await seed();
    const { tokenHash } = createResetToken();
    await store.createPasswordReset({
      userId: user.id,
      tokenHash,
      expiresAt: resetExpiresAt(),
      delivery: "admin",
      requestedIp: "5.6.7.8",
    });

    const rows = await store.listPendingPasswordResets();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      email: "member@example.com",
      displayName: "회원",
      hasPassword: true,
      delivery: "admin",
    });
    expect(rows[0]).not.toHaveProperty("tokenHash");
  });

  it("keeps a working password after a reset", async () => {
    const { store, user } = await seed();
    const { token, tokenHash } = createResetToken();
    await store.createPasswordReset({ userId: user.id, tokenHash, expiresAt: resetExpiresAt(), delivery: "email" });
    const consumed = await store.consumePasswordReset(tokenHash);
    expect(consumed).not.toBeNull();

    const changedAt = new Date().toISOString();
    await store.updateUser(user.id, { passwordHash: hashPassword("new-password-2"), passwordChangedAt: changedAt });

    const credentials = await store.getUserCredentials("member@example.com");
    expect(verifyPassword("new-password-2", credentials?.passwordHash)).toBe(true);
    expect(verifyPassword("old-password-1", credentials?.passwordHash)).toBe(false);
    expect(credentials?.user.passwordChangedAt).toBe(changedAt);
    expect(token).toBeTruthy();
  });
});

describe("session freshness after a password change", () => {
  it("logs out sessions issued before the change", () => {
    const changedAt = "2026-11-24T01:00:00.000Z";
    const changedSeconds = Math.floor(Date.parse(changedAt) / 1000);
    expect(isSessionFresh({ passwordChangedAt: changedAt }, changedSeconds - 60)).toBe(false);
    expect(isSessionFresh({ passwordChangedAt: changedAt }, changedSeconds + 1)).toBe(true);
    expect(isSessionFresh({ passwordChangedAt: null }, 0)).toBe(true);
  });
});
