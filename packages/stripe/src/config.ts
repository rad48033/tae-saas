export interface BillingConfig {
  apiKey: string | null;
  storeId: string | null;
  storeSlug: string;
  webhookSecret: string | null;
  variants: Record<string, string | undefined>;
}

export function loadBillingConfig(env: Record<string, string | undefined> = process.env): BillingConfig {
  return {
    apiKey: env.LEMONSQUEEZY_API_KEY?.trim() || null,
    storeId: env.LEMONSQUEEZY_STORE_ID?.trim() || null,
    storeSlug: env.LEMONSQUEEZY_STORE_SLUG?.trim() || "taest",
    webhookSecret: env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim() || null,
    variants: {
      LEMONSQUEEZY_VARIANT_STARTER: env.LEMONSQUEEZY_VARIANT_STARTER?.trim(),
      LEMONSQUEEZY_VARIANT_PRO: env.LEMONSQUEEZY_VARIANT_PRO?.trim(),
      LEMONSQUEEZY_VARIANT_SCALE: env.LEMONSQUEEZY_VARIANT_SCALE?.trim(),
    },
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
