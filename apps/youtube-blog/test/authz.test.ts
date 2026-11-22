import { describe, expect, it } from "vitest";

import { MemoryStore } from "@tae/db";

import { assertOwnedRenderJob, getOwnedJob } from "../src/lib/ownership";

async function seededStore() {
  const store = new MemoryStore();
  const alice = await store.createUser({ email: "alice@example.com", displayName: "앨리스", passwordHash: "hash" });
  const bob = await store.createUser({ email: "bob@example.com", displayName: "밥" });
  const guest = await store.createUser();
  return { store, alice, bob, guest };
}

describe("user store (auth)", () => {
  it("creates email users with a password and guests without one", async () => {
    const { store, alice, guest } = await seededStore();
    expect(alice.signupProvider).toBe("email");
    expect(alice.hasPassword).toBe(true);
    expect(guest.signupProvider).toBe("guest");
    expect(guest.hasPassword).toBe(false);

    const credentials = await store.getUserCredentials("ALICE@example.com");
    expect(credentials?.user.id).toBe(alice.id);
    expect(credentials?.passwordHash).toBe("hash");
    expect(await store.getUserCredentials("nobody@example.com")).toBeNull();
  });

  it("links oauth accounts and reuses them on the next login", async () => {
    const { store, alice } = await seededStore();
    const account = await store.upsertOAuthAccount({
      userId: alice.id,
      provider: "naver",
      providerUserId: "naver-1",
      email: alice.email,
      nickname: "앨리스",
    });
    expect(account.userId).toBe(alice.id);
    expect((await store.findOAuthAccount("naver", "naver-1"))?.id).toBe(account.id);

    const again = await store.upsertOAuthAccount({
      userId: alice.id,
      provider: "naver",
      providerUserId: "naver-1",
      email: alice.email,
      nickname: "새 닉네임",
    });
    expect(again.id).toBe(account.id);
    expect(again.nickname).toBe("새 닉네임");
    expect(await store.listOAuthAccounts(alice.id)).toHaveLength(1);
  });

  it("moves guest jobs to the account but not guest credits", async () => {
    const { store, alice, guest } = await seededStore();
    await store.grantSignupBonus(guest.id, 10);
    const job = await store.createJob({ userId: guest.id, app: "youtube_blog", status: "succeeded" });

    await expect(store.transferJobs(guest.id, alice.id)).resolves.toBe(1);
    expect((await store.getJob(job.id))?.userId).toBe(alice.id);
    expect((await store.getBalance(guest.id)).balance).toBe(10);
    expect((await store.getBalance(alice.id)).balance).toBe(0);
  });

  it("gives the signup bonus only once", async () => {
    const { store, alice } = await seededStore();
    expect(await store.grantSignupBonus(alice.id, 10)).toBe(10);
    expect(await store.grantSignupBonus(alice.id, 10)).toBe(10);
  });
});

describe("ownership checks", () => {
  it("returns own jobs and hides other users' jobs", async () => {
    const { store, alice, bob } = await seededStore();
    const job = await store.createJob({ userId: alice.id, app: "youtube_blog", status: "succeeded" });

    await expect(getOwnedJob(store, alice.id, job.id)).resolves.toMatchObject({ id: job.id });
    await expect(getOwnedJob(store, bob.id, job.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(getOwnedJob(store, bob.id, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("only lets the render owner read a video job id", async () => {
    const { store, alice, bob } = await seededStore();
    const renderJob = await store.createJob({
      userId: alice.id,
      app: "youtube_blog",
      status: "running",
      input: { kind: "video_render", videoJobId: "vj-abc", title: "릴스", aspectRatio: "9:16" },
    });
    await store.updateJob(renderJob.id, { output: { videoJobId: "vj-abc" } });

    await expect(assertOwnedRenderJob(store, alice.id, "vj-abc")).resolves.toMatchObject({ id: renderJob.id });
    await expect(assertOwnedRenderJob(store, bob.id, "vj-abc")).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(assertOwnedRenderJob(store, alice.id, "vj-unknown")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("admin store", () => {
  it("searches users, reports credit balances and counts admins", async () => {
    const { store, alice, bob, guest } = await seededStore();
    await store.grantSignupBonus(alice.id, 10);
    await store.grantCredits({ userId: alice.id, amount: 40, kind: "adjustment", description: "크몽 주문" });
    await store.updateUser(bob.id, { role: "admin" });

    const all = await store.listAdminUsers({});
    expect(all.total).toBe(3);
    expect(all.users.map((row) => row.user.id).sort()).toEqual([alice.id, bob.id, guest.id].sort());

    const found = await store.listAdminUsers({ query: "alice" });
    expect(found.total).toBe(1);
    expect(found.users[0]).toMatchObject({ balance: 50, lifetimeGranted: 50 });

    const byName = await store.listAdminUsers({ query: "밥" });
    expect(byName.users[0]?.user.id).toBe(bob.id);

    expect(await store.countAdmins()).toBe(1);
    await store.updateUser(alice.id, { role: "admin" });
    expect(await store.countAdmins()).toBe(2);

    const empty = await store.listAdminUsers({ query: "없는사람" });
    expect(empty).toEqual({ users: [], total: 0 });
  });

  it("summarizes the dashboard numbers", async () => {
    const { store, alice, bob } = await seededStore();
    await store.grantSignupBonus(alice.id, 10);
    await store.grantSignupBonus(bob.id, 10);
    await store.consumeCredits({ userId: alice.id, amount: 3, description: "영상 기획" });
    const textJob = await store.createJob({ userId: alice.id, app: "youtube_blog", status: "succeeded" });
    await store.updateJob(textJob.id, { output: { format: "blog" } });
    const videoJob = await store.createJob({ userId: bob.id, app: "youtube_blog", status: "running" });
    await store.updateJob(videoJob.id, { output: { format: "youtube_video" } });

    const overview = await store.getAdminOverview();
    expect(overview.totalUsers).toBe(3);
    expect(overview.members).toBe(2);
    expect(overview.guests).toBe(1);
    expect(overview.totalJobs).toBe(2);
    expect(overview.textJobs).toBe(1);
    expect(overview.videoJobs).toBe(1);
    expect(overview.creditBalance).toBe(17);
    expect(overview.creditGranted).toBe(20);
    expect(overview.creditUsed).toBe(3);

    const recent = await store.listRecentJobs(10);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.userEmail).toBeTruthy();
  });

  it("records admin audit entries", async () => {
    const { store, alice } = await seededStore();
    await expect(
      store.recordAdminAction({ adminUserId: alice.id, action: "credits.grant", targetUserId: alice.id, amount: 10, reason: "test" }),
    ).resolves.toBeUndefined();
  });
});
