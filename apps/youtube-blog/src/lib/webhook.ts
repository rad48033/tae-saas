import type { Store } from "@tae/db";
import {
  findPackByVariantId,
  isCreditGrantEvent,
  loadBillingConfig,
  parseOrderEvent,
  verifyWebhookSignature,
  type BillingConfig,
} from "@tae/stripe";

export interface WebhookInput {
  rawBody: string;
  signature: string | null;
  store: Store;
  env?: Record<string, string | undefined>;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * LemonSqueezy 웹훅 처리.
 * - 원문 바디로 서명을 검증하고(파싱 전),
 * - 이벤트 ID 기준으로 중복 지급을 막고,
 * - order_created에서 variant → 크레딧팩을 찾아 지급합니다.
 * 실패한 이벤트는 재시도 시 다시 처리합니다.
 */
export async function processLemonSqueezyWebhook(input: WebhookInput): Promise<WebhookResult> {
  const config: BillingConfig = loadBillingConfig(input.env ?? process.env);

  if (!config.webhookSecret) {
    return { status: 503, body: { error: "LEMONSQUEEZY_WEBHOOK_SECRET이 설정되지 않았습니다." } };
  }

  if (!verifyWebhookSignature(input.rawBody, input.signature, config.webhookSecret)) {
    return { status: 401, body: { error: "서명이 올바르지 않습니다." } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody) as unknown;
  } catch {
    return { status: 400, body: { error: "JSON 본문이 아닙니다." } };
  }

  let event;
  try {
    event = parseOrderEvent(payload);
  } catch {
    return { status: 400, body: { error: "LemonSqueezy 이벤트 형식이 아닙니다." } };
  }

  const recorded = await input.store.recordWebhookEvent({
    id: event.eventId,
    provider: "lemonsqueezy",
    eventName: event.eventName,
    payload: payload as Record<string, unknown>,
  });

  if (!recorded.isNew) {
    const existing = await input.store.getWebhookEvent(event.eventId);
    if (existing && existing.status !== "failed") {
      return { status: 200, body: { ok: true, duplicate: true } };
    }
  }

  try {
    if (!isCreditGrantEvent(event.eventName)) {
      await input.store.markWebhookEvent(event.eventId, "ignored");
      return { status: 200, body: { ok: true, ignored: event.eventName } };
    }

    if (event.status !== "paid") {
      await input.store.markWebhookEvent(event.eventId, "ignored", `status=${event.status}`);
      return { status: 200, body: { ok: true, ignored: `status=${event.status}` } };
    }

    const pack = event.variantId ? findPackByVariantId(event.variantId, input.env ?? process.env) : null;
    if (!pack) {
      await input.store.markWebhookEvent(event.eventId, "unmatched", `variant=${event.variantId ?? "null"}`);
      return { status: 200, body: { ok: true, unmatched: true } };
    }

    const user = event.userId
      ? await input.store.getUser(event.userId)
      : event.email
        ? await input.store.findUserByEmail(event.email)
        : null;

    if (!user) {
      await input.store.markWebhookEvent(event.eventId, "skipped", "사용자를 찾을 수 없음");
      return { status: 200, body: { ok: true, skipped: "user_not_found" } };
    }

    const order = await input.store.createOrder({
      userId: user.id,
      provider: "lemonsqueezy",
      providerOrderId: event.orderId,
      variantId: event.variantId,
      packId: pack.id,
      status: event.status,
      totalCents: event.totalCents,
      currency: event.currency,
      buyerEmail: event.email,
      creditsGranted: pack.credits,
    });

    const balance = await input.store.grantCredits({
      userId: user.id,
      amount: pack.credits,
      kind: "purchase",
      description: `${pack.nameKo} 크레딧 ${pack.credits}개`,
      orderId: order.id,
      metadata: { providerOrderId: event.orderId, variantId: event.variantId, testMode: event.testMode },
    });

    await input.store.markWebhookEvent(event.eventId, "processed");
    return { status: 200, body: { ok: true, credits: pack.credits, balance } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.store.markWebhookEvent(event.eventId, "failed", message).catch(() => undefined);
    // 5xx를 돌려주면 LemonSqueezy가 재시도합니다.
    return { status: 500, body: { error: "웹훅 처리에 실패했습니다.", detail: message } };
  }
}
