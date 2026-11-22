export interface BillingConfig {
  apiKey: string | null;
  storeId: string | null;
  storeSlug: string;
  webhookSecret: string | null;
  /** LemonSqueezy Variant ID (크레딧 팩 4종 + 월 구독 3종) */
  variants: Record<string, string | undefined>;
}

export const VARIANT_ENV_KEYS = [
  "LEMONSQUEEZY_VARIANT_LIGHT",
  "LEMONSQUEEZY_VARIANT_STANDARD",
  "LEMONSQUEEZY_VARIANT_PRO",
  "LEMONSQUEEZY_VARIANT_STUDIO",
  "LEMONSQUEEZY_SUBSCRIPTION_LIGHT",
  "LEMONSQUEEZY_SUBSCRIPTION_PRO",
  "LEMONSQUEEZY_SUBSCRIPTION_STUDIO",
] as const;

export function loadBillingConfig(env: Record<string, string | undefined> = process.env): BillingConfig {
  const variants: Record<string, string | undefined> = {};
  for (const key of VARIANT_ENV_KEYS) {
    variants[key] = env[key]?.trim();
  }

  return {
    apiKey: env.LEMONSQUEEZY_API_KEY?.trim() || null,
    storeId: env.LEMONSQUEEZY_STORE_ID?.trim() || null,
    storeSlug: env.LEMONSQUEEZY_STORE_SLUG?.trim() || "taest",
    webhookSecret: env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim() || null,
    variants,
  };
}

export class BillingError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "invalid_signature" | "invalid_payload" | "api_error",
    readonly status = 400,
  ) {
    super(message);
    this.name = "BillingError";
  }
}
