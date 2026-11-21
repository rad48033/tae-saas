import { BuyButton } from "./buy-button";

export interface PackView {
  id: string;
  name: string;
  nameKo: string;
  description: string;
  credits: number;
  priceLabel: string;
  variantId: string | null;
  badge: string | null;
}

export function Pricing({ packs }: { packs: PackView[] }) {
  return (
    <section id="pricing" className="container-page scroll-mt-20 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <span className="chip">크레딧 요금제</span>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">필요할 때만 충전하세요</h2>
        <p className="mt-3 text-slate-600">
          크레딧 1개로 블로그·인스타·페이스북 콘텐츠 1개를 만들 수 있습니다. 구독 없이, 쓴 만큼만.
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className={`card relative flex flex-col p-6 ${
              pack.badge ? "ring-2 ring-brand-500" : ""
            }`}
          >
            {pack.badge ? (
              <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                {pack.badge}
              </span>
            ) : null}

            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-bold text-ink">{pack.nameKo}</h3>
              <span className="text-xs font-medium text-slate-400">{pack.name}</span>
            </div>

            <p className="mt-4 flex items-baseline gap-1">
              <span className="text-3xl font-extrabold tracking-tight text-ink">{pack.priceLabel}</span>
              <span className="text-sm text-slate-500">/ {pack.credits}크레딧</span>
            </p>

            <p className="mt-3 min-h-[44px] text-sm leading-relaxed text-slate-600">{pack.description}</p>

            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> 블로그·인스타·페이스북 1회씩
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> 한국어 / English
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> 크레딧 유효기간 없음
              </li>
            </ul>

            <div className="mt-6">
              <BuyButton packId={pack.id} label={`${pack.credits}크레딧 충전`} />
              {!pack.variantId ? (
                <p className="mt-2 text-center text-[11px] text-slate-400">
                  결제 Variant ID가 아직 연결되지 않았습니다 (관리자 설정 필요)
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        결제는 LemonSqueezy를 통해 안전하게 처리됩니다. 결제 즉시 크레딧이 자동 충전됩니다.
      </p>
    </section>
  );
}
