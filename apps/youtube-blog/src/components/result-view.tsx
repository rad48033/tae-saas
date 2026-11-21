"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ContentDraft } from "@tae/ai";

import { draftCharacterCounts, draftToDownload, draftToPlainText, facebookFeedLineCount } from "@/lib/format-export";

import type { ConvertResult } from "./converter";
import { CopyButton } from "./copy-button";

const FORMAT_LABEL: Record<ContentDraft["format"], string> = {
  blog: "블로그 포스팅",
  instagram: "인스타 포스팅",
  facebook: "페이스북 포스팅",
};

type SlideRole = NonNullable<Extract<ContentDraft, { format: "instagram" }>["slides"][number]["role"]>;

const SLIDE_ROLE_STYLE: Record<SlideRole, { label: string; chip: string }> = {
  cover: { label: "표지", chip: "bg-brand-50 text-brand-700" },
  point: { label: "핵심", chip: "bg-slate-100 text-slate-600" },
  caveat: { label: "주의 · 팁", chip: "bg-amber-100 text-amber-800" },
  summary: { label: "요약 · CTA", chip: "bg-fuchsia-50 text-fuchsia-700" },
};

function slideRole(slide: { role?: SlideRole }, index: number, total: number): SlideRole {
  if (slide.role) return slide.role;
  if (index === 0) return "cover";
  if (index === total - 1) return "summary";
  if (index === total - 2) return "caveat";
  return "point";
}

export function ResultView({ result }: { result: ConvertResult }) {
  const { draft, source, meta, credits } = result;
  if (!draft) return null;
  const download = draftToDownload(draft);
  const plainText = draftToPlainText(draft);
  const counts = draftCharacterCounts(draft);

  function saveFile() {
    const blob = new Blob([download.content], { type: download.mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = download.fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <article className="card overflow-hidden">
      <header className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                {FORMAT_LABEL[draft.format]}
              </span>
              <span className="chip">{draft.language === "ko" ? "한국어" : "English"}</span>
              <span className={`chip ${meta.mode === "demo" ? "!bg-amber-100 !text-amber-800" : ""}`}>
                {meta.mode === "demo" ? "데모 초안" : "Claude 작성"}
              </span>
              <span className="chip">크레딧 {credits.charged} 사용 · {credits.remaining} 남음</span>
            </div>
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block truncate text-sm font-medium text-slate-700 hover:text-brand-700"
                title={source.title}
              >
                {source.sourceType === "youtube" ? "🎬" : source.sourceType === "instagram" ? "📸" : "📄"} {source.title}
                <span className="ml-1 font-normal text-slate-400">· {source.author}</span>
              </a>
            ) : (
              <span className="mt-2 block truncate text-sm font-medium text-slate-700" title={source.title}>
                {source.sourceType === "youtube" ? "🎬" : source.sourceType === "instagram" ? "📸" : "📄"} {source.title}
                <span className="ml-1 font-normal text-slate-400">· {source.author}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <CopyButton text={plainText} label="전체 복사" />
            <button type="button" onClick={saveFile} className="btn-ghost !py-1.5 text-xs">
              {draft.format === "blog" ? "Markdown 저장" : "텍스트 저장"}
            </button>
          </div>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <div>
            <dt className="inline">생성 </dt>
            <dd className="inline">{Math.max(1, Math.round(meta.durationMs / 1000))}초</dd>
          </div>
          <div>
            <dt className="inline">원문 </dt>
            <dd className="inline">{(meta.textChars ?? 0).toLocaleString()}자</dd>
          </div>
          <div>
            <dt className="inline">모델 </dt>
            <dd className="inline">{meta.model}</dd>
          </div>
          {meta.inputTokens + meta.outputTokens > 0 ? (
            <div>
              <dt className="inline">토큰 </dt>
              <dd className="inline">
                {(meta.inputTokens + meta.outputTokens).toLocaleString()} (${meta.costUsd.toFixed(4)})
              </dd>
            </div>
          ) : null}
          {counts.map((item) => (
            <div key={item.label}>
              <dt className="inline">{item.label} </dt>
              <dd className={`inline ${item.limit && item.count > item.limit ? "text-rose-500" : ""}`}>
                {item.count.toLocaleString()}
                {item.limit ? ` / ${item.limit.toLocaleString()}${item.unit ?? "자"}` : (item.unit ?? "자")}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="p-5 sm:p-7">
        {draft.format === "blog" ? <BlogResult draft={draft} /> : null}
        {draft.format === "instagram" ? <InstagramResult draft={draft} /> : null}
        {draft.format === "facebook" ? <FacebookResult draft={draft} /> : null}
      </div>
    </article>
  );
}

function BlogResult({ draft }: { draft: Extract<ContentDraft, { format: "blog" }> }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-extrabold leading-snug tracking-tight text-ink">{draft.title}</h3>
        <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
          <span className="mr-1 font-semibold text-slate-500">메타 설명</span>
          {draft.metaDescription}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="chip !bg-brand-50 !text-brand-700">본문 {draft.body.length.toLocaleString()}자</span>
          <span className="chip">H2 {draft.outline.length}개</span>
          <span className="chip">FAQ {draft.faq.length}개</span>
          <span className="chip">태그 {draft.tags.length}개</span>
          {draft.readingTimeMinutes ? (
            <span className="chip !bg-brand-50 !text-brand-700">약 {draft.readingTimeMinutes}분</span>
          ) : null}
        </div>
      </div>

      {draft.executiveSummary ? (
        <div className="rounded-xl border border-brand-100 bg-brand-50/70 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">한눈에 보는 요약</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{draft.executiveSummary}</p>
        </div>
      ) : null}

      {draft.keyTakeaways.length > 0 ? (
        <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">핵심 요약</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
            {draft.keyTakeaways.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-brand-500">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">목차</p>
        <ol className="mt-2 grid gap-2 sm:grid-cols-2">
          {draft.outline.map((section, index) => (
            <li key={`${section.heading}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="mr-2 text-xs font-bold text-brand-600">{String(index + 1).padStart(2, "0")}</span>
              <span className="text-sm font-medium text-slate-700">{section.heading}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="prose prose-slate max-w-none prose-headings:font-bold prose-h2:mt-8 prose-h2:text-xl prose-h3:text-lg prose-p:leading-relaxed prose-a:text-brand-600">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.body}</ReactMarkdown>
      </div>

      {draft.faq.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">자주 묻는 질문 {draft.faq.length}개</p>
          {draft.faq.map((item) => (
            <details key={item.question} className="rounded-xl border border-slate-200 px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">{item.question}</summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.answer}</p>
            </details>
          ))}
        </div>
      ) : null}

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">SEO 태그 {draft.tags.length}개</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {draft.tags.map((tag) => (
            <span key={tag} className="chip">
              #{tag.replace(/^#/, "")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function InstagramResult({ draft }: { draft: Extract<ContentDraft, { format: "instagram" }> }) {
  const roles = draft.slides.map((slide, index) => slideRole(slide, index, draft.slides.length));
  const roleSummary = (["cover", "point", "caveat", "summary"] as const)
    .map((role) => ({ role, count: roles.filter((value) => value === role).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${SLIDE_ROLE_STYLE[item.role].label} ${item.count}`)
    .join(" + ");

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-fuchsia-600 p-5 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Hook</p>
        <p className="mt-1 text-xl font-bold leading-snug">{draft.hook}</p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            카드뉴스 {draft.slides.length}장 <span className="font-normal normal-case text-slate-400">· {roleSummary}</span>
          </p>
          <CopyButton
            text={draft.slides.map((slide) => `${slide.index}. ${slide.title}\n${slide.body}`).join("\n\n")}
            label="카드 복사"
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {draft.slides.map((slide, index) => {
            const role = slideRole(slide, index, draft.slides.length);
            return (
              <div key={slide.index} className="flex min-h-[150px] flex-col rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-brand-600">
                    {String(slide.index).padStart(2, "0")} / {String(draft.slides.length).padStart(2, "0")}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SLIDE_ROLE_STYLE[role].chip}`}>
                    {SLIDE_ROLE_STYLE[role].label}
                  </span>
                </div>
                <p className="mt-1 text-sm font-bold leading-snug text-slate-900">{slide.title}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{slide.body}</p>
                {slide.visualHint ? (
                  <p className="mt-auto pt-2 text-[10px] text-slate-400">디자인: {slide.visualHint}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">캡션</p>
          <CopyButton text={`${draft.caption}\n\n${draft.hashtags.join(" ")}`} label="캡션 복사" />
        </div>
        <div className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
          {draft.caption}
        </div>
        <p className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800">
          {draft.cta}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            해시태그 {draft.hashtags.length}개
          </p>
          <CopyButton text={draft.hashtags.join(" ")} label="해시태그 복사" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {draft.hashtags.map((tag) => (
            <span key={tag} className="chip !bg-fuchsia-50 !text-fuchsia-700">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function FacebookResult({ draft }: { draft: Extract<ContentDraft, { format: "facebook" }> }) {
  const lineCount = facebookFeedLineCount(draft);
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip !bg-brand-50 !text-brand-700">약 {lineCount}줄 피드</span>
          <span className="chip">핵심 불릿 {draft.bullets.length}개</span>
          <span className="chip">질문 1개</span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-base font-bold text-slate-900">{draft.headline}</p>
        <div className="mt-3 space-y-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{draft.body}</div>

        {draft.bullets.length > 0 ? (
          <ul className="mt-4 space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            {draft.bullets.map((bullet) => (
              <li key={bullet} className="flex gap-2">
                <span className="text-brand-500">▸</span>
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-4 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">
          💬 {draft.closingQuestion}
        </p>

        {draft.hashtags.length > 0 ? (
          <p className="mt-3 text-sm text-brand-600">{draft.hashtags.join(" ")}</p>
        ) : null}
      </div>

      <div className="flex justify-end">
        <CopyButton text={draftToPlainText(draft)} label="피드 글 복사" />
      </div>
    </div>
  );
}
