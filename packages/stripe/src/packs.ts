/**
 * 크레딧 팩·구독 카탈로그 (수익화 플랜 v2).
 *
 * 가격·크레딧 수량은 여기서만 바꾸면 앱 UI와 웹훅 지급 로직에 모두 반영됩니다.
 * LemonSqueezy에는 같은 이름의 상품을 만들고, Variant ID를 환경변수로 연결하세요.
 *
 * v2 기준(2026-11-22): 영상 1편 원가가 텍스트 1편의 35~50배라 크레딧을 분리했습니다.
 *   글 1편 1크레딧 · 영상 1편(기획 3 + 렌더 6) 9크레딧 · PDF 10페이지 1크레딧
 */
export type CreditPackId = "light" | "standard" | "pro" | "studio";

export interface CreditPack {
  id: CreditPackId;
  name: string;
  nameKo: string;
  /** 이 팩으로 할 수 있는 일 한 줄 */
  tagline: string;
  credits: number;
  /** 원화 판매가 */
  priceKrw: number;
  badge?: string;
  variantEnvKey:
    | "LEMONSQUEEZY_VARIANT_LIGHT"
    | "LEMONSQUEEZY_VARIANT_STANDARD"
    | "LEMONSQUEEZY_VARIANT_PRO"
    | "LEMONSQUEEZY_VARIANT_STUDIO";
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: "light",
    name: "Light",
    nameKo: "라이트",
    tagline: "릴스 1편 + 글 1편",
    credits: 10,
    priceKrw: 12_000,
    variantEnvKey: "LEMONSQUEEZY_VARIANT_LIGHT",
  },
  {
    id: "standard",
    name: "Standard",
    nameKo: "스탠다드",
    tagline: "릴스 4편",
    credits: 40,
    priceKrw: 39_000,
    badge: "인기",
    variantEnvKey: "LEMONSQUEEZY_VARIANT_STANDARD",
  },
  {
    id: "pro",
    name: "Pro",
    nameKo: "프로",
    tagline: "릴스 13편",
    credits: 120,
    priceKrw: 99_000,
    variantEnvKey: "LEMONSQUEEZY_VARIANT_PRO",
  },
  {
    id: "studio",
    name: "Studio",
    nameKo: "스튜디오",
    tagline: "릴스 44편",
    credits: 400,
    priceKrw: 290_000,
    variantEnvKey: "LEMONSQUEEZY_VARIANT_STUDIO",
  },
] as const;

/** 월 구독: 매달 크레딧을 자동 지급하고 미사용분은 1개월만 이월합니다. */
export type SubscriptionPlanId = "light" | "pro" | "studio";

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  nameKo: string;
  monthlyKrw: number;
  /** 매달 지급하는 크레딧(텍스트 n편 + 릴스 m편을 크레딧으로 환산) */
  creditsPerMonth: number;
  texts: number;
  reels: number;
  summary: string;
  badge?: string;
  variantEnvKey:
    | "LEMONSQUEEZY_SUBSCRIPTION_LIGHT"
    | "LEMONSQUEEZY_SUBSCRIPTION_PRO"
    | "LEMONSQUEEZY_SUBSCRIPTION_STUDIO";
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    id: "light",
    nameKo: "라이트",
    monthlyKrw: 19_000,
    creditsPerMonth: 38,
    texts: 20,
    reels: 2,
    summary: "텍스트 20편 + 릴스 2편",
    variantEnvKey: "LEMONSQUEEZY_SUBSCRIPTION_LIGHT",
  },
  {
    id: "pro",
    nameKo: "프로",
    monthlyKrw: 49_000,
    creditsPerMonth: 85,
    texts: 40,
    reels: 5,
    summary: "텍스트 40편 + 릴스 5편",
    badge: "인기",
    variantEnvKey: "LEMONSQUEEZY_SUBSCRIPTION_PRO",
  },
  {
    id: "studio",
    nameKo: "스튜디오",
    monthlyKrw: 149_000,
    creditsPerMonth: 285,
    texts: 150,
    reels: 15,
    summary: "텍스트 150편 + 릴스 15편",
    variantEnvKey: "LEMONSQUEEZY_SUBSCRIPTION_STUDIO",
  },
] as const;

export interface ResolvedPack extends CreditPack {
  variantId: string | null;
  priceLabel: string;
  /** 크레딧 1개 단가(원) */
  unitKrw: number;
}

export interface ResolvedSubscriptionPlan extends SubscriptionPlan {
  variantId: string | null;
  priceLabel: string;
  /** 결제 상품(Variant)이 아직 연결되지 않았으면 false */
  available: boolean;
}

export function resolvePacks(env: Record<string, string | undefined>): ResolvedPack[] {
  return CREDIT_PACKS.map((pack) => ({
    ...pack,
    variantId: env[pack.variantEnvKey]?.trim() || null,
    priceLabel: formatKrw(pack.priceKrw),
    unitKrw: Math.round(pack.priceKrw / pack.credits),
  }));
}

export function findPack(packId: string, env: Record<string, string | undefined>): ResolvedPack | null {
  return resolvePacks(env).find((pack) => pack.id === packId) ?? null;
}

export function findPackByVariantId(variantId: string, env: Record<string, string | undefined>): ResolvedPack | null {
  return resolvePacks(env).find((pack) => pack.variantId === variantId) ?? null;
}

export function resolveSubscriptions(env: Record<string, string | undefined>): ResolvedSubscriptionPlan[] {
  return SUBSCRIPTION_PLANS.map((plan) => {
    const variantId = env[plan.variantEnvKey]?.trim() || null;
    return {
      ...plan,
      variantId,
      priceLabel: formatKrw(plan.monthlyKrw),
      available: Boolean(variantId),
    };
  });
}

export function formatKrw(krw: number): string {
  return `₩${Math.round(krw).toLocaleString("ko-KR")}`;
}

/** 원화 금액을 LemonSqueezy API가 쓰는 최소 단위(원 단위 그대로)로 바꿉니다. */
export function krwToMinorUnits(krw: number): number {
  return Math.round(krw);
}
