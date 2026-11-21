import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { BillingError } from "./config";

/**
 * LemonSqueezy 웹훅 서명 검증.
 * 서명은 raw body 전체에 대한 HMAC-SHA256(hex)이며 `X-Signature` 헤더로 옵니다.
 * body를 파싱하기 전에 원문 그대로 검증해야 합니다.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signature.trim().toLowerCase();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

const orderEventSchema = z.object({
  meta: z
    .object({
      event_name: z.string(),
      custom_data: z.record(z.unknown()).optional(),
      test_mode: z.boolean().optional(),
    })
    .passthrough(),
  data: z
    .object({
      type: z.string(),
      id: z.string(),
      attributes: z
        .object({
          store_id: z.number().optional(),
          order_number: z.number().optional(),
          user_email: z.string().optional(),
          currency: z.string().optional(),
          total: z.number().optional(),
          status: z.string().optional(),
          created_at: z.string().optional(),
          first_order_item: z
            .object({
              product_id: z.number().optional(),
              variant_id: z.number().optional(),
              product_name: z.string().optional(),
              variant_name: z.string().optional(),
              price: z.number().optional(),
              quantity: z.number().optional(),
            })
            .optional(),
        })
        .passthrough(),
    })
    .passthrough(),
});

export interface ParsedOrderEvent {
  /** 멱등 키: 이벤트명 + 주문 ID (LemonSqueezy는 이벤트 고유 ID를 주지 않습니다) */
  eventId: string;
  eventName: string;
  orderId: string;
  orderNumber: number | null;
  variantId: string | null;
  productName: string | null;
  userId: string | null;
  email: string | null;
  totalCents: number | null;
  currency: string | null;
  status: string;
  testMode: boolean;
  createdAt: string | null;
}

export function parseOrderEvent(payload: unknown): ParsedOrderEvent {
  const parsed = orderEventSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BillingError("LemonSqueezy 웹훅 형식이 아닙니다.", "invalid_payload");
  }

  const { meta, data } = parsed.data;
  const attributes = data.attributes;
  const custom = meta.custom_data ?? {};
  const rawUserId = typeof custom.user_id === "string" ? custom.user_id : null;
  const variantId = attributes.first_order_item?.variant_id;

  return {
    eventId: `${meta.event_name}:${data.id}`,
    eventName: meta.event_name,
    orderId: data.id,
    orderNumber: attributes.order_number ?? null,
    variantId: variantId === undefined ? null : String(variantId),
    productName: attributes.first_order_item?.product_name ?? null,
    userId: rawUserId,
    email: attributes.user_email ?? null,
    totalCents: attributes.total ?? null,
    currency: attributes.currency ?? null,
    status: attributes.status ?? "unknown",
    testMode: meta.test_mode ?? false,
    createdAt: attributes.created_at ?? null,
  };
}

/** 지원하는 이벤트인지(크레딧 지급 대상) 판별합니다. */
export function isCreditGrantEvent(eventName: string): boolean {
  return eventName === "order_created";
}

export function isRefundEvent(eventName: string): boolean {
  return eventName === "order_refunded";
}
