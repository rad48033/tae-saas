import { resolvePacks } from "@tae/stripe";

import { Converter } from "@/components/converter";
import { Pricing, type PackView } from "@/components/pricing";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getRuntime } from "@/lib/runtime";

const FORMAT_CARDS = [
  {
    icon: "📝",
    title: "블로그 포스팅",
    body: "인플루언서급 장문 SEO 글. 훅으로 시작해 4~5개 H2 섹션, 사례·비교·장단점, 실행 결론까지 문단으로 씁니다.",
    details: ["본문 2,000~3,500자", "H2 4~5개 + 한눈에 보는 요약", "FAQ 3~5개 · 태그 8~10개"],
  },
  {
    icon: "📸",
    title: "인스타 포스팅",
    body: "스크롤을 멈추는 훅, 10장 카드뉴스, 여러 문단 캡션과 15~20개 해시태그를 한 번에. 표지·핵심·주의·요약 순서로 구성합니다.",
    details: ["훅 + 카드뉴스 10장", "캡션 700~2,000자", "해시태그 15~20개"],
  },
  {
    icon: "💬",
    title: "페이스북 포스팅",
    body: "장면으로 시작하는 약 20줄 스토리텔링 피드 글. 중간에 핵심 불릿과 한계 짚기를 넣고, 댓글을 부르는 질문으로 끝냅니다.",
    details: ["약 20줄 피드", "핵심 불릿 4~6개", "질문으로 마무리"],
  },
] as const;

const FAQ = [
  {
    question: "자막이 없는 영상도 되나요?",
    answer:
      "자막(자동 생성 포함)이 있는 공개 영상만 지원합니다. 자막이 없으면 영상 내용을 근거로 삼을 수 없어 오류로 안내합니다.",
  },
  {
    question: "영상에 없는 내용을 지어내지 않나요?",
    answer:
      "프롬프트에서 자막 근거만 사용하도록 제한하고, 화자의 주장은 귀속시켜 표현합니다. 그래도 발행 전 사실 확인은 필요합니다.",
  },
  {
    question: "크레딧은 어떻게 차감되나요?",
    answer:
      "콘텐츠 1개당 1크레딧입니다. 변환에 실패하면 차감된 크레딧은 자동으로 환불됩니다.",
  },
  {
    question: "PDF도 JSON으로 바꿀 수 있나요?",
    answer:
      "네. 별도의 PDF API(api.taest.info)에서 PDF를 텍스트·구조화 JSON으로 변환할 수 있습니다. API 키로 사용합니다.",
  },
];

export default function HomePage() {
  const runtime = getRuntime();
  const packs: PackView[] = resolvePacks(process.env).map((pack) => ({
    id: pack.id,
    name: pack.name,
    nameKo: pack.nameKo,
    description: pack.description,
    credits: pack.credits,
    priceLabel: pack.priceLabel,
    variantId: pack.variantId,
    badge: pack.badge ?? null,
  }));

  return (
    <div className="min-h-screen">
      <SiteHeader pdfUrl={process.env.NEXT_PUBLIC_PDF_APP_URL ?? "https://api.taest.info"} />

      <main>
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 left-1/2 h-[460px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-b from-brand-100 via-indigo-50 to-transparent blur-3xl"
          />
          <div className="container-page relative pb-10 pt-14 sm:pt-20">
            <div className="mx-auto max-w-3xl text-center">
              <span className="chip">유튜브 → 블로그 · 인스타 · 페이스북</span>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.15] tracking-tight text-ink sm:text-5xl">
                영상 하나로,
                <br className="sm:hidden" /> <span className="text-brand-600">세 채널</span>의 콘텐츠를
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
                유튜브 링크만 넣으면 자막을 읽고 근거 있는 초안을 만듭니다. 인플루언서급 SEO 블로그, 인스타 카드뉴스
                10장, 페이스북 20줄 피드까지 한 번에.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-slate-500">
                <span>자막 근거</span>
                <span aria-hidden>·</span>
                <span>한국어 / English</span>
                <span aria-hidden>·</span>
                <span>블로그 2,000자+</span>
                <span aria-hidden>·</span>
                <span>카드뉴스 10장</span>
                <span aria-hidden>·</span>
                <span>해시태그 15~20개</span>
              </div>
            </div>

            <div className="mt-10">
              <Converter demoMode={runtime.aiMode === "demo"} />
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-20 border-y border-slate-100 bg-slate-50/60 py-16">
          <div className="container-page">
            <div className="mx-auto max-w-2xl text-center">
              <span className="chip">3가지 발행 형식</span>
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                채널마다 다른 문법에 맞춰
              </h2>
              <p className="mt-3 text-slate-600">
                같은 영상도 블로그·인스타·페이스북에서 성공하는 구조는 다릅니다. 형식을 고르면 그 채널의 문법으로
                다시 씁니다.
              </p>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {FORMAT_CARDS.map((card) => (
                <article key={card.title} className="card p-6">
                  <span className="text-2xl" aria-hidden>
                    {card.icon}
                  </span>
                  <h3 className="mt-3 text-lg font-bold text-ink">{card.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{card.body}</p>
                  <ul className="mt-4 space-y-1.5 text-xs text-slate-500">
                    {card.details.map((detail) => (
                      <li key={detail} className="flex items-center gap-2">
                        <span className="h-1 w-1 rounded-full bg-brand-500" />
                        {detail}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>

            <div className="mt-10 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-3">
              {[
                ["1", "유튜브 링크 붙여넣기", "자막이 있는 공개 영상이면 됩니다."],
                ["2", "발행 형식 선택", "블로그 · 인스타 · 페이스북"],
                ["3", "복사해서 발행", "마크다운·텍스트로 저장, 바로 붙여넣기"],
              ].map(([step, title, body]) => (
                <div key={step} className="flex gap-3">
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
                    {step}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Pricing packs={packs} />

        <section className="border-t border-slate-100 py-16">
          <div className="container-page mx-auto max-w-3xl">
            <h2 className="text-2xl font-extrabold tracking-tight text-ink">자주 묻는 질문</h2>
            <div className="mt-6 space-y-3">
              {FAQ.map((item) => (
                <details key={item.question} className="card px-5 py-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
                    {item.question}
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
