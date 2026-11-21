import { resolvePacks } from "@tae/stripe";

import { Converter } from "@/components/converter";
import { Pricing, type PackView } from "@/components/pricing";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getRuntime, VIDEO_CONVERT_COST } from "@/lib/runtime";
import { getVideoConfig } from "@/lib/video";

const SOURCE_CARDS = [
  {
    icon: "▶️",
    title: "유튜브",
    body: "영상 링크나 '스크립트 표시'로 복사한 자막을 원문으로 씁니다.",
    outputs: "→ 블로그 · 인스타 · 페이스북",
  },
  {
    icon: "📄",
    title: "블로그 글",
    body: "글 주소에서 본문을 읽거나, 붙여넣은 글을 그대로 원문으로 씁니다.",
    outputs: "→ 유튜브 영상 · 인스타 · 페이스북",
  },
  {
    icon: "📸",
    title: "인스타 글",
    body: "카드뉴스 문구와 캡션을 모아 하나의 이야기로 다시 씁니다.",
    outputs: "→ 유튜브 영상 · 블로그 · 페이스북",
  },
] as const;

const FORMAT_CARDS = [
  {
    icon: "🎬",
    title: "유튜브 영상",
    body: "장면별 스토리보드와 나레이션 대본을 만들고, AI 이미지·TTS·자막을 붙여 MP4까지 렌더합니다.",
    details: ["9:16 쇼츠 · 16:9 가로형", "장면 5~12개 · 45~180초", "SRT · ASS · MP4"],
  },
  {
    icon: "📝",
    title: "블로그 포스팅",
    body: "인플루언서급 장문 SEO 글. 훅으로 시작해 H2 섹션, 사례·비교·장단점, 실행 결론까지 문단으로 씁니다.",
    details: ["본문 2,000~3,500자", "H2 4~5개 + 한눈에 보는 요약", "FAQ 3~5개 · 태그 8~10개"],
  },
  {
    icon: "📸",
    title: "인스타 포스팅",
    body: "스크롤을 멈추는 훅, 10장 카드뉴스, 여러 문단 캡션과 15~20개 해시태그를 한 번에.",
    details: ["훅 + 카드뉴스 10장", "캡션 700~2,000자", "해시태그 15~20개"],
  },
  {
    icon: "💬",
    title: "페이스북 포스팅",
    body: "장면으로 시작하는 약 20줄 스토리텔링 피드 글. 핵심 불릿과 댓글을 부르는 질문으로 끝냅니다.",
    details: ["약 20줄 피드", "핵심 불릿 4~6개", "질문으로 마무리"],
  },
] as const;

const FAQ = [
  {
    question: "어떤 원문을 넣을 수 있나요?",
    answer:
      "유튜브 영상(자막), 블로그 글, 인스타그램 캡션 세 가지입니다. 각 원문에 따라 만들 수 있는 결과가 정해져 있고, 화면에서 자동으로 바뀝니다.",
  },
  {
    question: "영상은 진짜 MP4로 만들어지나요?",
    answer:
      "네. 스토리보드 → 장면 이미지 → TTS 나레이션 → STT 자막 → ffmpeg 렌더 순서로 MP4를 만듭니다. Vercel 서버리스는 긴 렌더를 못 돌리므로 video-worker를 Railway·Fly.io·Cloud Run에 배포하고 VIDEO_WORKER_URL로 연결합니다.",
  },
  {
    question: "9:16과 16:9는 무엇이 다른가요?",
    answer:
      "9:16 쇼츠는 1080x1920, 45~60초, 5~8장면입니다. 16:9 가로형은 1920x1080, 90~180초, 8~12장면입니다. 같은 원문이라도 장면 수와 호흡을 다르게 나눕니다.",
  },
  {
    question: "영상에 들어가는 그림과 목소리는 무엇인가요?",
    answer:
      "OPENAI_API_KEY가 설정되어 있으면 gpt-image-1(또는 dall-e-3) 이미지와 OpenAI TTS 음성을 씁니다. 키가 없으면 데모용 결정적 이미지·음성으로 전체 흐름을 그대로 확인할 수 있습니다.",
  },
  {
    question: "원문에 없는 내용을 지어내지 않나요?",
    answer:
      "프롬프트에서 원문 근거만 사용하도록 제한하고, 필자의 주장은 귀속시켜 표현합니다. 그래도 발행 전 사실 확인은 필요합니다.",
  },
  {
    question: "크레딧은 어떻게 차감되나요?",
    answer: `텍스트 콘텐츠는 1개당 1크레딧, 유튜브 영상 기획은 ${VIDEO_CONVERT_COST}크레딧입니다. 변환에 실패하면 차감된 크레딧은 자동으로 환불됩니다.`,
  },
];

export default function HomePage() {
  const runtime = getRuntime();
  const videoConfig = getVideoConfig();
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
              <span className="chip">유튜브 · 블로그 · 인스타 → 네 가지 결과</span>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.15] tracking-tight text-ink sm:text-5xl">
                원문 하나로,
                <br className="sm:hidden" /> <span className="text-brand-600">영상과 세 채널</span>의 콘텐츠를
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
                유튜브 자막, 블로그 본문, 인스타 캡션을 넣으면 채널에 맞는 초안을 만듭니다. 장면별 스토리보드와
                나레이션, AI 이미지, 음성, 자막까지 붙은 MP4도 이 화면에서.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-slate-500">
                <span>원문 근거</span>
                <span aria-hidden>·</span>
                <span>한국어 / English</span>
                <span aria-hidden>·</span>
                <span>9:16 · 16:9 MP4</span>
                <span aria-hidden>·</span>
                <span>블로그 2,000자+</span>
                <span aria-hidden>·</span>
                <span>카드뉴스 10장</span>
              </div>
            </div>

            <div className="mt-10">
              <Converter
                demoMode={runtime.aiMode === "demo"}
                videoCredits={VIDEO_CONVERT_COST}
                videoMode={videoConfig.mode}
              />
            </div>
          </div>
        </section>

        <section id="sources" className="scroll-mt-20 border-y border-slate-100 bg-slate-50/60 py-16">
          <div className="container-page">
            <div className="mx-auto max-w-2xl text-center">
              <span className="chip">3가지 입력 · 4가지 출력</span>
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                가진 원문에서 시작하세요
              </h2>
              <p className="mt-3 text-slate-600">
                입력마다 가장 자연스러운 결과가 정해져 있습니다. 하나의 원문을 다른 채널의 문법으로 다시 쓰는 것이
                핵심입니다.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {SOURCE_CARDS.map((card) => (
                <article key={card.title} className="card p-6">
                  <span className="text-2xl" aria-hidden>
                    {card.icon}
                  </span>
                  <h3 className="mt-3 text-lg font-bold text-ink">{card.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{card.body}</p>
                  <p className="mt-4 text-xs font-semibold text-brand-700">{card.outputs}</p>
                </article>
              ))}
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {FORMAT_CARDS.map((card) => (
                <article key={card.title} className="card p-5">
                  <span className="text-2xl" aria-hidden>
                    {card.icon}
                  </span>
                  <h3 className="mt-3 text-base font-bold text-ink">{card.title}</h3>
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

            <div className="mt-10 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-4">
              {[
                ["1", "원문 넣기", "유튜브·블로그·인스타 중 하나"],
                ["2", "결과 고르기", "영상 · 블로그 · 인스타 · 페이스북"],
                ["3", "화면 비율 선택", "쇼츠 9:16 또는 16:9"],
                ["4", "복사 · 렌더", "텍스트 저장, 영상은 MP4로"],
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
