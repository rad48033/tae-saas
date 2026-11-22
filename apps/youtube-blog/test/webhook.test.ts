import { describe, expect, it } from "vitest";

import { MemoryStore } from "@tae/db";
import { signWebhookBody } from "@tae/stripe";

import { processLemonSqueezyWebhook } from "../src/lib/webhook";

const SECRET = "whsec_test";
const ENV = {
  LEMONSQUEEZY_WEBHOOK_SECRET: SECRET,
  LEMONSQUEEZY_VARIANT_LIGHT: "111",
  LEMONSQUEEZY_VARIANT_STANDARD: "222",
  LEMONSQUEEZY_VARIANT_PRO: "333",
  LEMONSQUEEZY_VARIANT_STUDIO: "444",
};

function orderPayload(userId: string, overrides: { variantId?: number; status?: string; eventName?: string } = {}) {
  return {
    meta: {
      event_name: overrides.eventName ?? "order_created",
      test_mode: true,
      custom_data: { user_id: userId, pack_id: "standard" },
    },
    data: {
      type: "orders",
      id: "9001",
      attributes: {
        order_number: 12,
        user_email: "buyer@example.com",
        currency: "KRW",
        total: 39000,
        status: overrides.status ?? "paid",
        created_at: "2026-11-21T10:00:00.000000Z",
        first_order_item: {
          product_id: 1,
          variant_id: overrides.variantId ?? 222,
          product_name: "Tae SaaS Credits",
          variant_name: "Standard",
          price: 39000,
          quantity: 1,
        },
      },
    },
  };
}

async function setupUser() {
  const store = new MemoryStore();
  const user = await store.createUser({ email: "buyer@example.com" });
  return { store, user };
}

describe("LemonSqueezy webhook", () => {
  it("grants the credits for a paid order", async () => {
    const { store, user } = await setupUser();
    const rawBody = JSON.stringify(orderPayload(user.id));

    const result = await processLemonSqueezyWebhook({
      rawBody,
      signature: signWebhookBody(rawBody, SECRET),
      store,
      env: ENV,
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, credits: 40 });
    expect((await store.getBalance(user.id)).balance).toBe(40);
  });

  it("is idempotent for repeated deliveries", async () => {
    const { store, user } = await setupUser();
    const rawBody = JSON.stringify(orderPayload(user.id));
    const signature = signWebhookBody(rawBody, SECRET);

    await processLemonSqueezyWebhook({ rawBody, signature, store, env: ENV });
    const second = await processLemonSqueezyWebhook({ rawBody, signature, store, env: ENV });

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    expect((await store.getBalance(user.id)).balance).toBe(40);
  });

  it("rejects an invalid signature without touching credits", async () => {
    const { store, user } = await setupUser();
    const rawBody = JSON.stringify(orderPayload(user.id));

    const result = await processLemonSqueezyWebhook({
      rawBody,
      signature: "deadbeef",
      store,
      env: ENV,
    });

    expect(result.status).toBe(401);
    expect((await store.getBalance(user.id)).balance).toBe(0);
  });

  it("stores nothing when the webhook secret is missing", async () => {
    const { store, user } = await setupUser();
    const rawBody = JSON.stringify(orderPayload(user.id));

    const result = await processLemonSqueezyWebhook({ rawBody, signature: "x", store, env: {} });
    expect(result.status).toBe(503);
    expect((await store.getBalance(user.id)).balance).toBe(0);
  });

  it("acknowledges but does not grant for unknown variants", async () => {
    const { store, user } = await setupUser();
    const rawBody = JSON.stringify(orderPayload(user.id, { variantId: 999 }));

    const result = await processLemonSqueezyWebhook({
      rawBody,
      signature: signWebhookBody(rawBody, SECRET),
      store,
      env: ENV,
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ unmatched: true });
    expect((await store.getBalance(user.id)).balance).toBe(0);
  });

  it("ignores unpaid orders and other events", async () => {
    const { store, user } = await setupUser();

    const pendingBody = JSON.stringify(orderPayload(user.id, { status: "pending" }));
    const pending = await processLemonSqueezyWebhook({
      rawBody: pendingBody,
      signature: signWebhookBody(pendingBody, SECRET),
      store,
      env: ENV,
    });
    expect(pending.body).toMatchObject({ ignored: "status=pending" });

    const otherBody = JSON.stringify(orderPayload(user.id, { eventName: "subscription_created" }));
    const other = await processLemonSqueezyWebhook({
      rawBody: otherBody,
      signature: signWebhookBody(otherBody, SECRET),
      store,
      env: ENV,
    });
    expect(other.body).toMatchObject({ ignored: "subscription_created" });
    expect((await store.getBalance(user.id)).balance).toBe(0);
  });

  it("falls back to the buyer email when custom data is absent", async () => {
    const { store, user } = await setupUser();
    const payload = orderPayload(user.id);
    delete (payload.meta as { custom_data?: unknown }).custom_data;
    const rawBody = JSON.stringify(payload);

    const result = await processLemonSqueezyWebhook({
      rawBody,
      signature: signWebhookBody(rawBody, SECRET),
      store,
      env: ENV,
    });

    expect(result.body).toMatchObject({ credits: 40 });
    expect((await store.getBalance(user.id)).balance).toBe(40);
  });
});
