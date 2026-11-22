import { describe, expect, it, vi } from "vitest";

import { loadBillingConfig } from "../src/config";
import { buildStaticCheckoutUrl, createCheckout } from "../src/checkout";
import {
  findPack,
  findPackByVariantId,
  formatKrw,
  resolvePacks,
  resolveSubscriptions,
} from "../src/packs";
import { parseOrderEvent, signWebhookBody, verifyWebhookSignature } from "../src/webhook";

const env = {
  LEMONSQUEEZY_API_KEY: "ls_api_key",
  LEMONSQUEEZY_STORE_ID: "12345",
  LEMONSQUEEZY_STORE_SLUG: "taest",
  LEMONSQUEEZY_WEBHOOK_SECRET: "whsec_test",
  LEMONSQUEEZY_VARIANT_LIGHT: "111",
  LEMONSQUEEZY_VARIANT_STANDARD: "222",
  LEMONSQUEEZY_VARIANT_PRO: "333",
  LEMONSQUEEZY_VARIANT_STUDIO: "444",
};

const config = loadBillingConfig(env);

const orderPayload = {
  meta: {
    event_name: "order_created",
    test_mode: false,
    custom_data: { user_id: "8f1f0f26-0a0b-4a2e-9c6e-3a7a1f2f1a11", pack_id: "standard" },
  },
  data: {
    type: "orders",
    id: "4321",
    attributes: {
      store_id: 12345,
      order_number: 7,
      user_email: "buyer@example.com",
      currency: "KRW",
      total: 39000,
      status: "paid",
      created_at: "2026-11-21T10:00:00.000000Z",
      first_order_item: {
        product_id: 1,
        variant_id: 222,
        product_name: "Tae SaaS Credits",
        variant_name: "Standard",
        price: 39000,
        quantity: 1,
      },
    },
  },
};

describe("webhook verification", () => {
  it("matches a known HMAC vector", () => {
    const body = '{"event":"order_created","data":{"id":"42"}}';
    expect(verifyWebhookSignature(body, "590939950c201d0c79bccbc1f383298e530c60296eb457d093fbccf12948bd64", "whsec_test")).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets and missing headers", () => {
    const body = JSON.stringify(orderPayload);
    const signature = signWebhookBody(body, "whsec_test");
    expect(verifyWebhookSignature(body, signature, "whsec_test")).toBe(true);
    expect(verifyWebhookSignature(`${body} `, signature, "whsec_test")).toBe(false);
    expect(verifyWebhookSignature(body, signature, "other_secret")).toBe(false);
    expect(verifyWebhookSignature(body, null, "whsec_test")).toBe(false);
    expect(verifyWebhookSignature(body, "not-hex", "whsec_test")).toBe(false);
  });
});

describe("parseOrderEvent", () => {
  it("extracts order, variant and custom user id", () => {
    const event = parseOrderEvent(orderPayload);
    expect(event).toMatchObject({
      eventId: "order_created:4321",
      orderId: "4321",
      variantId: "222",
      userId: "8f1f0f26-0a0b-4a2e-9c6e-3a7a1f2f1a11",
      email: "buyer@example.com",
      totalCents: 39000,
      currency: "KRW",
      status: "paid",
      testMode: false,
    });
  });

  it("handles a payload without custom data", () => {
    const event = parseOrderEvent({ ...orderPayload, meta: { event_name: "order_created" } });
    expect(event.userId).toBeNull();
    expect(event.variantId).toBe("222");
  });

  it("throws a billing error for unrelated payloads", () => {
    expect(() => parseOrderEvent({ hello: "world" })).toThrowError(/형식/);
  });
});

describe("packs (수익화 플랜 v2)", () => {
  it("원화 크레딧 팩 4종을 v2 가격·수량으로 둔다", () => {
    const packs = resolvePacks({});
    expect(packs.map((pack) => [pack.id, pack.priceKrw, pack.credits])).toEqual([
      ["light", 12_000, 10],
      ["standard", 39_000, 40],
      ["pro", 99_000, 120],
      ["studio", 290_000, 400],
    ]);
    expect(packs.map((pack) => pack.priceLabel)).toEqual(["₩12,000", "₩39,000", "₩99,000", "₩290,000"]);
    expect(packs[0]?.unitKrw).toBe(1_200);
    expect(packs[3]?.unitKrw).toBe(725);
  });

  it("환경변수의 Variant ID로 팩을 찾는다", () => {
    const packs = resolvePacks(env);
    expect(packs.find((pack) => pack.id === "standard")?.variantId).toBe("222");
    expect(findPackByVariantId("444", env)?.id).toBe("studio");
    expect(findPack("nope", env)).toBeNull();
  });

  it("원화 표기를 만든다", () => {
    expect(formatKrw(12000)).toBe("₩12,000");
    expect(formatKrw(290000)).toBe("₩290,000");
  });
});

describe("subscriptions (월 구독 3종)", () => {
  it("월 가격과 포함 편수를 v2 값으로 둔다", () => {
    const plans = resolveSubscriptions({});
    expect(plans.map((plan) => [plan.id, plan.monthlyKrw])).toEqual([
      ["light", 19_000],
      ["pro", 49_000],
      ["studio", 149_000],
    ]);
    expect(plans.map((plan) => plan.summary)).toEqual([
      "텍스트 20편 + 릴스 2편",
      "텍스트 40편 + 릴스 5편",
      "텍스트 150편 + 릴스 15편",
    ]);
  });

  it("지급 크레딧은 텍스트 1 + 릴스 9 기준을 넘고, Variant가 없으면 준비 중으로 둔다", () => {
    for (const plan of resolveSubscriptions({})) {
      expect(plan.creditsPerMonth).toBeGreaterThanOrEqual(plan.texts + plan.reels * 9);
      expect(plan.available).toBe(false);
    }
    expect(resolveSubscriptions({ LEMONSQUEEZY_SUBSCRIPTION_PRO: "900" })[1]?.available).toBe(true);
  });
});

describe("checkout", () => {
  it("builds a static checkout url with user id custom data", () => {
    const pack = findPack("light", env);
    expect(pack).not.toBeNull();
    const url = buildStaticCheckoutUrl(config, {
      pack: pack!,
      userId: "user-1",
      email: "a@b.com",
      redirectUrl: "https://blog.taest.info/success",
    });
    expect(url).toContain("https://taest.lemonsqueezy.com/buy/111?");
    expect(url).toContain("checkout[custom][user_id]=user-1");
    expect(url).toContain("checkout[email]=a%40b.com");
  });

  it("calls the checkouts API when credentials exist", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { attributes: { url: "https://taest.lemonsqueezy.com/checkout/buy/abc" } } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const pack = findPack("light", env)!;
    const result = await createCheckout(
      config,
      { pack, userId: "user-1", email: "a@b.com" },
      fetchMock as unknown as typeof fetch,
    );

    expect(result.mode).toBe("api");
    expect(result.url).toContain("checkout/buy/abc");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    const body = JSON.parse(String(init.body)) as {
      data: { attributes: { checkout_data: { custom: { user_id: string } } } };
    };
    expect(body.data.attributes.checkout_data.custom.user_id).toBe("user-1");
  });

  it("fails clearly when a variant id is missing", async () => {
    const bareEnv = { ...env, LEMONSQUEEZY_VARIANT_LIGHT: "" };
    const pack = findPack("light", bareEnv)!;
    await expect(createCheckout(loadBillingConfig(bareEnv), { pack, userId: "u" })).rejects.toThrowError(/Variant ID/);
  });
});
