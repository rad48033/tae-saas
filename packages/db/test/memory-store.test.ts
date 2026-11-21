import { describe, expect, it } from "vitest";

import { MemoryStore } from "../src/memory-store";
import { generateApiKey, hashApiKey } from "../src/keys";

describe("MemoryStore users", () => {
  it("deduplicates users by email", async () => {
    const store = new MemoryStore();
    const first = await store.createUser({ email: "a@example.com" });
    const second = await store.createUser({ email: "a@example.com" });
    expect(second.id).toBe(first.id);
    expect(await store.getOrCreateUserByEmail("A@example.com")).toMatchObject({ id: first.id });
  });

  it("allows anonymous users without email", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    expect(user.email).toBeNull();
    expect(await store.getUser(user.id)).not.toBeNull();
  });
});

describe("MemoryStore credits", () => {
  it("grants the signup bonus only once", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    expect(await store.grantSignupBonus(user.id, 2)).toBe(2);
    expect(await store.grantSignupBonus(user.id, 2)).toBe(2);
    expect((await store.getBalance(user.id)).balance).toBe(2);
  });

  it("consumes and refunds, keeping the ledger consistent", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    await store.grantCredits({ userId: user.id, amount: 5, kind: "purchase" });

    const consumed = await store.consumeCredits({ userId: user.id, amount: 3, jobId: "job-1" });
    expect(consumed).toEqual({ ok: true, balance: 2 });

    await store.refundCredits({ userId: user.id, amount: 3, jobId: "job-1" });
    const balance = await store.getBalance(user.id);
    expect(balance.balance).toBe(5);
    expect(balance.lifetimeUsed).toBe(0);

    const transactions = await store.listTransactions(user.id);
    expect(transactions.map((tx) => tx.kind)).toEqual(["refund", "consume", "purchase"]);
    expect(transactions.reduce((sum, tx) => sum + tx.amount, 0)).toBe(balance.balance);
  });

  it("refuses to spend more than the balance", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    await store.grantCredits({ userId: user.id, amount: 1, kind: "purchase" });

    const result = await store.consumeCredits({ userId: user.id, amount: 2 });
    expect(result).toEqual({ ok: false, balance: 1 });
    expect((await store.getBalance(user.id)).balance).toBe(1);
  });

  it("never allows a negative balance through adjustment", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    await expect(
      store.grantCredits({ userId: user.id, amount: -1, kind: "adjustment" }),
    ).rejects.toThrowError(/부족/);
  });
});

describe("MemoryStore API keys", () => {
  it("stores only the hash and finds it again", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    const { record, secret } = await store.createApiKey({ userId: user.id, name: "ci" });

    expect(secret.startsWith("tae_live_")).toBe(true);
    expect(record.prefix).not.toBe(secret);
    expect(await store.findApiKeyByHash(hashApiKey(secret))).toMatchObject({ id: record.id, name: "ci" });
    expect(await store.findApiKeyByHash(hashApiKey(`${secret}x`))).toBeNull();
  });

  it("hides revoked keys", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    const { record, secret } = await store.createApiKey({ userId: user.id });

    await store.revokeApiKey(user.id, record.id);
    expect(await store.findApiKeyByHash(hashApiKey(secret))).toBeNull();
    expect((await store.listApiKeys(user.id))[0]?.revokedAt).not.toBeNull();
  });
});

describe("MemoryStore jobs and webhooks", () => {
  it("creates and updates a job", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    const job = await store.createJob({ userId: user.id, app: "pdf_api", input: { pages: 3 } });

    const updated = await store.updateJob(job.id, {
      status: "succeeded",
      creditsCharged: 1,
      completedAt: new Date().toISOString(),
    });
    expect(updated.status).toBe("succeeded");
    expect((await store.listJobs(user.id))[0]?.id).toBe(job.id);
  });

  it("treats a repeated webhook as a duplicate", async () => {
    const store = new MemoryStore();
    const input = { id: "evt_1", provider: "lemonsqueezy", eventName: "order_created", payload: { a: 1 } };
    expect(await store.recordWebhookEvent(input)).toEqual({ isNew: true });
    expect(await store.recordWebhookEvent(input)).toEqual({ isNew: false });
  });

  it("upserts orders by provider order id", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    const first = await store.createOrder({
      userId: user.id,
      provider: "lemonsqueezy",
      providerOrderId: "1234",
      status: "paid",
      creditsGranted: 0,
    });
    const second = await store.createOrder({
      userId: user.id,
      provider: "lemonsqueezy",
      providerOrderId: "1234",
      status: "refunded",
    });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("refunded");
  });
});

describe("generateApiKey", () => {
  it("produces url-safe, unique secrets", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.secret).not.toBe(b.secret);
    expect(a.secret).toMatch(/^tae_live_[A-Za-z0-9_-]{32}$/);
    expect(a.hash).toHaveLength(64);
    expect(a.prefix.startsWith("tae_live_")).toBe(true);
  });
});
