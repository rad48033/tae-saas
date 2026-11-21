/**
 * 크레딧 팩 카탈로그.
 * 가격·크레딧 수량은 여기서만 바꾸면 두 앱 UI와 웹훅 지급 로직에 모두 반영됩니다.
 * LemonSqueezy에는 같은 이름의 상품을 만들고, Variant ID를 환경변수로 연결하세요.
 */
export type CreditPackId = "starter" | "pro" | "scale";

export interface CreditPack {
  id: CreditPackId;
  name: string;
  nameKo: string;
  description: string;
  credits: number;
  /** USD 센트 */
  priceCents: number;
  badge?: string;
  variantEnvKey: "LEMONSQUEEZY_VARIANT_STARTER" | "LEMONSQUEEZY_VARIANT_PRO" | "LEMONSQUEEZY_VARIANT_SCALE";
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: "starter",
    name: "Starter",
    nameKo: "스타터",
    description: "가볍게 써보기 — 블로그 30편 또는 PDF 300페이지",
    credits: 30,
    priceCents: 900,
    variantEnvKey: "LEMONSQUEEZY_VARIANT_STARTER",
  },
  {
    id: "pro",
    name: "Pro",
    nameKo: "프로",
    description: "꾸준히 발행하는 1인 사업자 — 블로그 150편 또는 PDF 1,500페이지",
    credits: 150,
    priceCents: 2900,
    badge: "인기",
    variantEnvKey: "LEMONSQUEEZY_VARIANT_PRO",
  },
  {
    id: "scale",
    name: "Scale",
    nameKo: "스케일",
    description: "팀·에이전시용 대용량 — 블로그 600편 또는 PDF 6,000페이지",
    credits: 600,
    priceCents: 7900,
    variantEnvKey: "LEMONSQUEEZY_VARIANT_SCALE",
  },
] as const;

export interface ResolvedPack extends CreditPack {
  variantId: string | null;
  priceLabel: string;
}

export function resolvePacks(env: Record<string, string | undefined>): ResolvedPack[] {
  return CREDIT_PACKS.map((pack) => ({
    ...pack,
    variantId: env[pack.variantEnvKey]?.trim() || null,
    priceLabel: formatPrice(pack.priceCents),
  }));
}

export function findPack(packId: string, env: Record<string, string | undefined>): ResolvedPack | null {
  return resolvePacks(env).find((pack) => pack.id === packId) ?? null;
}

export function findPackByVariantId(variantId: string, env: Record<string, string | undefined>): ResolvedPack | null {
  return resolvePacks(env).find((pack) => pack.variantId === variantId) ?? null;
}

export function formatPrice(cents: number, currency = "USD"): string {
  const symbol = currency.toUpperCase() === "USD" ? "$" : "";
  const amount = cents / 100;
  return Number.isInteger(amount) ? `${symbol}${amount}` : `${symbol}${amount.toFixed(2)}`;
}

/** 1000원 미만 소수점은 반올림해서 보여줍니다(한국어 UI 보조 표기). */
export function formatKrw(cents: number): string {
  const krw = Math.round((cents / 100) * 1_380);
  return `₩${krw.toLocaleString("ko-KR")}`;
}
