"use client";

import type { ResolvedPack, ResolvedSubscriptionPlan } from "@tae/stripe";

import type { CreditCosts } from "@/lib/api-types";

import { BoltIcon, CheckIcon, SparkIcon } from "./app-icons";
import { BuyButton } from "./buy-button";

export function CreditsView({
  packs,
  subscriptions,
  costs,
  credits,
  onNavigate,
}: {
  packs: ResolvedPack[];
  subscriptions: ResolvedSubscriptionPlan[];
  costs: CreditCosts;
  credits: number | null;
  onNavigate: (tab: "studio" | "library" | "settings") => void;
}) {
  return (
    <div className="container-page py-4 lg:py-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white shadow-app sm:p-8">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/20 blur-2xl" />
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">내 크레딧</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-black tracking-tight sm:text-5xl">{credits ?? "–"}</span>
            <span className="text-sm text-white/70">크레딧</span>
          </p>
          <p className="mt-2 max-w-md text-xs leading-relaxed text-white/75">
            글 1편 1크레딧 · 영상 1편 {costs.videoTotal}크레딧(기획 {costs.videoStoryboard} + 렌더 {costs.videoRender}).
            첫 방문에 {costs.trial}크레딧을 드려 릴스 1편을 그대로 체험할 수 있습니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate("studio")}
              className="rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-night-900"
            >
              지금 만들기
            </button>
            <button
              type="button"
              onClick={() => onNavigate("library")}
              className="rounded-xl bg-white/15 px-4 py-2.5 text-xs font-bold text-white ring-1 ring-white/25"
            >
              보관함 보기
            </button>
          </div>
        </div>

        <section className="card p-5">
          <div className="flex items-center gap-2">
            <BoltIcon className="h-4 w-4 text-brand-600" />
            <h2 className="section-title !text-sm">차감 기준</h2>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">작업</th>
                  <th className="w-20 px-3 py-2 text-right font-semibold">크레딧</th>
                  <th className="hidden px-3 py-2 font-semibold sm:table-cell">비고</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  [`글 1편(블로그 · 인스타 · 페이스북 중 하나)`, `${costs.text}`, "실패 시 자동 환불"],
                  [`글 3종 한 번에`, `${costs.textSet}`, "세 채널을 한 작업으로"],
                  [`영상 기획(스토리보드 · 대본 · 자막)`, `${costs.videoStoryboard}`, "렌더 없이 대본까지"],
                  [`MP4 렌더`, `${costs.videoRender}`, "이미지 · 음성 · ffmpeg"],
                  [`영상 1편 합계`, `${costs.videoTotal}`, "기획 + 렌더"],
                  [`미리보기 렌더`, `${costs.videoPreview}`, "저해상도로 빠르게"],
                  [`PDF 변환`, `${costs.pdfPagesPerCredit}쪽당 1`, "최소 1 · 실패 시 자동 환불"],
                  [`첫 방문 체험`, `${costs.trial} 지급`, "계정당 1회"],
                ].map(([label, credit, note]) => (
                  <tr key={label}>
                    <td className="px-3 py-2 font-medium text-slate-700">{label}</td>
                    <td className="px-3 py-2 text-right font-bold text-ink">{credit}</td>
                    <td className="hidden px-3 py-2 text-slate-500 sm:table-cell">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-end justify-between px-1">
            <div>
              <h2 className="section-title">충전 팩</h2>
              <p className="text-xs text-slate-500">필요할 때마다 충전하고, 쓰지 않으면 그대로 둡니다.</p>
            </div>
            <span className="chip whitespace-nowrap">카드 · 간편결제</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {packs.map((pack) => (
              <div
                key={pack.id}
                className={`card relative flex flex-col p-4 ${pack.badge ? "ring-2 ring-brand-500" : ""}`}
              >
                {pack.badge ? (
                  <span className="absolute right-3 top-3 rounded-full bg-brand-600 px-2.5 py-0.5 text-[10px] font-bold text-white">
                    {pack.badge}
                  </span>
                ) : null}
                <p className="text-xs font-bold text-slate-400">{pack.name}</p>
                <p className="mt-1 text-lg font-extrabold text-ink">{pack.nameKo}</p>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-black tracking-tight text-ink">{pack.priceLabel}</span>
                  <span className="text-[11px] text-slate-500">/ {pack.credits}크레딧</span>
                </p>
                <p className="mt-1 text-[11px] text-slate-500">크레딧당 {pack.unitKrw.toLocaleString("ko-KR")}원</p>
                <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-brand-700">
                  <CheckIcon className="h-3.5 w-3.5" /> {pack.tagline}
                </p>
                <div className="mt-auto pt-3">
                  <BuyButton
                    packId={pack.id}
                    label={pack.variantId ? "충전하기" : "결제 준비 중"}
                    disabled={!pack.variantId}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-slate-400">
            결제는 Lemon Squeezy를 통해 처리되고 카드 영수증은 이메일로 발송됩니다. 결제 즉시 크레딧이 자동 충전됩니다.
            {packs.every((pack) => !pack.variantId) ? " (관리자 화면에서 상품 Variant ID를 연결하면 버튼이 켜집니다.)" : ""}
          </p>
        </section>

        <section>
          <div className="mb-2 flex items-end justify-between px-1">
            <div>
              <h2 className="section-title">월 구독</h2>
              <p className="text-xs text-slate-500">매달 크레딧을 자동 지급하고, 미사용분은 1개월만 이월됩니다.</p>
            </div>
            <span className="chip">
              <SparkIcon className="h-3.5 w-3.5" /> 준비 중
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {subscriptions.map((plan) => (
              <div key={plan.id} className={`card p-4 ${plan.badge ? "ring-2 ring-brand-200" : ""}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-extrabold text-ink">{plan.nameKo}</p>
                  {plan.badge ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">
                      {plan.badge}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-black tracking-tight text-ink">{plan.priceLabel}</span>
                  <span className="text-[11px] text-slate-500">/ 월</span>
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{plan.summary}</p>
                <p className="mt-1 text-[11px] text-slate-400">월 {plan.creditsPerMonth}크레딧</p>
                <button
                  type="button"
                  disabled
                  className="mt-3 w-full rounded-xl bg-slate-100 py-2 text-[11px] font-bold text-slate-400"
                >
                  {plan.available ? "구독하기" : "곧 열립니다"}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-slate-400">
            구독 결제는 크레딧 팩 판매가 안정된 뒤 열 예정입니다. 그때까지는 충전 팩으로 필요한 만큼만 씁니다.
          </p>
        </section>
      </div>
    </div>
  );
}
