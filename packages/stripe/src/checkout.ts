import { z } from "zod";

import { BillingError, type BillingConfig } from "./config";
import type { ResolvedPack } from "./packs";

const LEMONSQUEEZY_API = "https://api.lemonsqueezy.com/v1";

export interface CheckoutRequest {
  pack: ResolvedPack;
  userId: string;
  email?: string | null;
  /** 결제 완료 후 돌아올 URL */
  redirectUrl?: string;
  /** 다크 테마 체크아웃 */
  dark?: boolean;
}

export interface CheckoutResult {
  url: string;
  mode: "api" | "static";
}

/**
 * 체크아웃 생성.
 * - API 키/스토어 ID가 있으면 Checkouts API로 만들고(이메일·custom data 사전 입력),
 * - 없으면 정적 체크아웃 URL로 대체합니다(로컬 개발용).
 * custom data의 user_id는 웹훅에서 크레딧을 지급할 대상을 찾는 유일한 연결고리입니다.
 */
export async function createCheckout(
  config: BillingConfig,
  request: CheckoutRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutResult> {
  if (!request.pack.variantId) {
    throw new BillingError(
      `${request.pack.id} 팩의 LemonSqueezy Variant ID가 설정되지 않았습니다.`,
      "not_configured",
      503,
    );
  }

  if (!config.apiKey || !config.storeId) {
    return { url: buildStaticCheckoutUrl(config, request), mode: "static" };
  }

  const body = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          email: request.email ?? undefined,
          custom: { user_id: request.userId, pack_id: request.pack.id },
        },
        checkout_options: {
          dark: request.dark ?? false,
          button_color: "#4f46e5",
        },
        product_options: {
          redirect_url: request.redirectUrl ?? undefined,
          enabled_variants: [Number(request.pack.variantId)],
        },
        expires_at: null,
      },
      relationships: {
        store: { data: { type: "stores", id: String(config.storeId) } },
        variant: { data: { type: "variants", id: String(request.pack.variantId) } },
      },
    },
  };

  const response = await fetchImpl(`${LEMONSQUEEZY_API}/checkouts`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await safeText(response);
    throw new BillingError(`LemonSqueezy 체크아웃 생성 실패 (${response.status}): ${detail}`, "api_error", 502);
  }

  const parsed = checkoutResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new BillingError("LemonSqueezy 응답 형식이 예상과 다릅니다.", "api_error", 502);
  }

  return { url: parsed.data.data.attributes.url, mode: "api" };
}

export function buildStaticCheckoutUrl(config: BillingConfig, request: CheckoutRequest): string {
  if (!request.pack.variantId) {
    throw new BillingError("Variant ID가 필요합니다.", "not_configured", 503);
  }

  const params: string[] = [];
  params.push(`checkout[custom][user_id]=${encodeURIComponent(request.userId)}`);
  params.push(`checkout[custom][pack_id]=${encodeURIComponent(request.pack.id)}`);
  if (request.email) params.push(`checkout[email]=${encodeURIComponent(request.email)}`);
  if (request.redirectUrl) params.push(`checkout[success_url]=${encodeURIComponent(request.redirectUrl)}`);
  params.push("embed=0", "media=0", "logo=0");
  if (request.dark) params.push("checkout[dark]=true");

  const slug = config.storeSlug.replace(/\.lemonsqueezy\.com$/i, "");
  return `https://${slug}.lemonsqueezy.com/buy/${request.pack.variantId}?${params.join("&")}`;
}

const checkoutResponseSchema = z.object({
  data: z.object({ attributes: z.object({ url: z.string().url() }) }),
});

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "(응답 본문 없음)";
  }
}
