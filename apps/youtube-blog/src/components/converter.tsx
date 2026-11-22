"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { OUTPUTS_BY_SOURCE, SOURCE_LABELS } from "@tae/ai/source";
import type { ContentDraft, ContentFormat, SourceType } from "@tae/ai";
import type { AspectRatio, Storyboard, SubtitleSet } from "@tae/video";

import { ResultView } from "./result-view";
import { VideoResultView } from "./video-result-view";

type Language = "ko" | "en";
export type OutputFormat = ContentFormat | "youtube_video";

export interface VideoPackagePayload {
  aspectRatio: AspectRatio;
  preset: {
    id: AspectRatio;
    label: string;
    width: number;
    height: number;
    sceneMin: number;
    sceneMax: number;
    durationMin: number;
    durationMax: number;
    totalSeconds: number;
  };
  storyboard: Storyboard;
  subtitles: { srt: string; ass: string; cueCount: number; source: SubtitleSet["source"] };
  render: { available: boolean; mode: "worker" | "inline" | "disabled"; reason: string | null };
}

export interface ConvertResult {
  jobId: string;
  format: OutputFormat;
  source: {
    sourceType: SourceType;
    title: string;
    author: string;
    url: string | null;
    thumbnailUrl: string | null;
    textChars: number;
    textSource: string;
    warnings: string[];
  };
  draft: ContentDraft | null;
  video: VideoPackagePayload | null;
  credits: { remaining: number; charged: number };
  meta: {
    provider: string;
    model: string;
    mode: "anthropic" | "demo";
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
    textChars?: number;
    textLanguage?: string;
    textSource?: string;
    warnings?: string[];
  };
}

const SOURCE_OPTIONS: { id: SourceType; icon: string; label: string; hint: string }[] = [
  { id: "youtube", icon: "▶️", label: "유튜브", hint: "영상 링크 · 자막" },
  { id: "blog", icon: "📄", label: "블로그 글", hint: "글 주소 · 본문" },
  { id: "instagram", icon: "📸", label: "인스타 글", hint: "캡션 · 카드 텍스트" },
];

const FORMAT_META: Record<OutputFormat, { icon: string; label: string; hint: string }> = {
  blog: { icon: "📝", label: "블로그 포스팅", hint: "인플루언서급 장문 · 본문 2,000자+ · FAQ · 태그 8~10" },
  instagram: { icon: "📸", label: "인스타 포스팅", hint: "훅 + 카드뉴스 10장 + 캡션 + 해시태그 15~20" },
  facebook: { icon: "💬", label: "페이스북 포스팅", hint: "20줄 피드 스토리 + 핵심 불릿 + 댓글 질문" },
  youtube_video: {
    icon: "🎬",
    label: "유튜브 영상",
    hint: "스토리보드 + 나레이션 + AI 이미지 + TTS + 자막 + MP4",
  },
};

const ASPECTS: { id: AspectRatio; label: string; hint: string }[] = [
  { id: "9:16", label: "9:16 쇼츠", hint: "1080x1920 · 45~60초 · 5~8장면" },
  { id: "16:9", label: "16:9 가로형", hint: "1920x1080 · 90~180초 · 8~12장면" },
];

const MIN_TEXT: Record<SourceType, number> = { youtube: 200, blog: 400, instagram: 80 };

export function Converter({
  demoMode,
  videoCredits = 1,
  videoMode = "inline",
}: {
  demoMode: boolean;
  videoCredits?: number;
  videoMode?: "worker" | "inline" | "disabled";
}) {
  const [sourceType, setSourceType] = useState<SourceType>("youtube");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [format, setFormat] = useState<OutputFormat>("blog");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [language, setLanguage] = useState<Language>("ko");
  const [focusKeyword, setFocusKeyword] = useState("");
  const [audience, setAudience] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  const allowedFormats = OUTPUTS_BY_SOURCE[sourceType];
  const labels = SOURCE_LABELS[sourceType];
  const isVideo = format === "youtube_video";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/credits")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { balance?: number } | null) => {
        if (!cancelled && typeof data?.balance === "number") setCredits(data.balance);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [busy]);

  function changeSource(next: SourceType) {
    setSourceType(next);
    setError(null);
    setResult(null);
    if (!(OUTPUTS_BY_SOURCE[next] as readonly string[]).includes(format)) {
      setFormat(OUTPUTS_BY_SOURCE[next][0] ?? "blog");
    }
  }

  const pasted = text.trim();
  const canSubmit = useMemo(() => {
    if (url.trim().length > 0) return true;
    return pasted.length >= MIN_TEXT[sourceType];
  }, [url, pasted, sourceType]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canSubmit) return;

    setBusy(true);
    setError(null);
    setErrorCode(null);
    setResult(null);
    setElapsed(0);

    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType,
          format,
          aspectRatio,
          language,
          ...(url.trim() ? { url: url.trim() } : {}),
          ...(pasted ? { [sourceType === "youtube" ? "transcript" : "text"]: pasted } : {}),
          ...(focusKeyword.trim() ? { focusKeyword: focusKeyword.trim() } : {}),
          ...(audience.trim() ? { audience: audience.trim() } : {}),
        }),
      });

      const data = (await response.json()) as ConvertResult & {
        error?: { code?: string; message?: string; details?: { balance?: number } };
      };

      if (!response.ok) {
        setError(data.error?.message ?? "변환에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        setErrorCode(data.error?.code ?? null);
        if (data.error?.code === "transcript_unavailable" || data.error?.code === "source_unavailable") {
          setShowAdvanced(true);
          window.setTimeout(() => document.getElementById("source-text")?.focus(), 50);
        }
        if (typeof data.error?.details?.balance === "number") setCredits(data.error.details.balance);
        return;
      }

      setResult(data);
      setCredits(data.credits.remaining);
      window.setTimeout(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch {
      setError("네트워크 오류가 발생했습니다. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="convert" className="scroll-mt-20">
      <form onSubmit={handleSubmit} className="card p-5 sm:p-7">
        {demoMode ? (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
            <strong className="font-semibold">데모 모드</strong> — AI 키(ANTHROPIC·OPENAI·GEMINI)가 설정되지 않아
            규칙 기반 초안을 만듭니다. 영상은 결정적 데모 이미지·음성으로 렌더되며, 키를 넣으면 실제 AI 대본·이미지·음성·자막
            타이밍으로 바뀝니다.
          </div>
        ) : null}

        <fieldset>
          <legend className="label">입력 유형</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {SOURCE_OPTIONS.map((option) => {
              const selected = sourceType === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => changeSource(option.id)}
                  aria-pressed={selected}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span aria-hidden className="text-base">
                    {option.icon}
                  </span>
                  <span>
                    <span className="block text-sm font-bold">{option.label}</span>
                    <span className={`block text-[11px] ${selected ? "text-white/70" : "text-slate-500"}`}>
                      {option.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="source-url" className="label">
              {labels.ko} 주소 <span className="font-normal normal-case text-slate-400">(선택)</span>
            </label>
            <input
              id="source-url"
              name="url"
              type="text"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={labels.inputPlaceholder}
              className="field"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 p-1">
              {(["ko", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLanguage(code)}
                  aria-pressed={language === code}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    language === code ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {code === "ko" ? "한국어" : "English"}
                </button>
              ))}
            </div>
            {credits !== null ? (
              <span className="chip whitespace-nowrap" title="남은 크레딧">
                크레딧 {credits}
              </span>
            ) : null}
          </div>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{labels.description}</p>

        <div className="mt-4">
          <label htmlFor="source-text" className="label">
            {labels.textLabel.ko} 직접 붙여넣기{" "}
            <span className="font-normal normal-case text-slate-400">
              ({sourceType === "youtube" ? "자동 추출이 막히면 여기에" : "주소를 못 읽거나 로그인이 필요하면 여기에"})
            </span>
          </label>
          <textarea
            id="source-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={showAdvanced || sourceType !== "youtube" ? 6 : 3}
            placeholder={
              sourceType === "youtube"
                ? "유튜브 영상 아래 '…더보기' → '스크립트 표시'를 열어 전체 복사한 뒤 붙여넣으세요."
                : sourceType === "blog"
                  ? "블로그 글 본문을 그대로 붙여넣으세요. 제목·소제목이 포함되면 더 좋습니다."
                  : "카드뉴스 각 장의 문구와 캡션을 붙여넣으세요. 훅·본문·CTA 순서면 충분합니다."
            }
            className="field resize-y font-mono text-xs leading-relaxed"
            maxLength={200_000}
          />
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[11px] leading-relaxed text-slate-400">
            <span>
              주소 또는 {MIN_TEXT[sourceType]}자 이상의 원문 중 하나는 필요합니다.
            </span>
            {pasted.length > 0 ? <span className="text-slate-500">{pasted.length.toLocaleString()}자 입력됨</span> : null}
          </p>
        </div>

        <fieldset className="mt-6">
          <legend className="label">만들 결과</legend>
          <div className={`grid gap-3 ${allowedFormats.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {allowedFormats.map((option) => {
              const meta = FORMAT_META[option];
              const selected = format === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFormat(option)}
                  aria-pressed={selected}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected
                      ? "border-brand-500 bg-brand-50/70 ring-2 ring-brand-100"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-lg" aria-hidden>
                    {meta.icon}
                  </span>
                  <span className={`mt-1 block text-sm font-bold ${selected ? "text-brand-800" : "text-slate-800"}`}>
                    {meta.label}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">{meta.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {isVideo ? (
          <fieldset className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <legend className="label">화면 비율</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {ASPECTS.map((option) => {
                const selected = aspectRatio === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setAspectRatio(option.id)}
                    aria-pressed={selected}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                      selected ? "border-brand-500 bg-white ring-2 ring-brand-100" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`flex-none rounded border-2 ${
                        selected ? "border-brand-500" : "border-slate-300"
                      } ${option.id === "9:16" ? "h-10 w-6" : "h-6 w-10"}`}
                    />
                    <span>
                      <span className="block text-sm font-bold text-slate-800">{option.label}</span>
                      <span className="block text-[11px] text-slate-500">{option.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {videoMode === "disabled"
                ? "현재 서버에서는 MP4 렌더가 꺼져 있습니다. 스토리보드·자막까지는 만들 수 있고, 영상 워커(VIDEO_WORKER_URL)를 연결하면 MP4까지 생성됩니다."
                : "스토리보드와 자막을 먼저 만들고, 결과 화면에서 MP4 렌더를 시작합니다. 렌더는 OpenAI 이미지·음성 키가 있으면 실제 AI로, 없으면 데모로 실행됩니다."}
            </p>
          </fieldset>
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? "고급 옵션 닫기" : "고급 옵션 (키워드·타깃 독자)"}
          </button>

          {showAdvanced ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="focus-keyword" className="label">
                  1차 키워드 (선택)
                </label>
                <input
                  id="focus-keyword"
                  value={focusKeyword}
                  onChange={(event) => setFocusKeyword(event.target.value)}
                  placeholder="예: 스타트업 100일"
                  className="field"
                  maxLength={80}
                />
              </div>
              <div>
                <label htmlFor="audience" className="label">
                  타깃 독자 (선택)
                </label>
                <input
                  id="audience"
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  placeholder="예: 1인 사업자, 마케터"
                  className="field"
                  maxLength={120}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || !canSubmit} className="btn-primary">
            {busy ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                만드는 중… {elapsed}s
              </>
            ) : (
              <>
                {isVideo ? "영상 기획하기" : "콘텐츠 만들기"}
                <span aria-hidden>→</span>
              </>
            )}
          </button>
          <span className="text-xs text-slate-500">
            크레딧 {isVideo ? videoCredits : 1}개 사용 · 보통 {isVideo ? "10~40" : "20~60"}초
          </span>
        </div>

        {busy ? (
          <ol className="mt-5 grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
            {(isVideo
              ? ["원문 확인", "스토리보드", "자막 생성", "완료"]
              : ["원문 확인", "내용 구조화", "검증", "완료"]
            ).map((step, index) => (
              <li
                key={step}
                className={`rounded-lg border px-3 py-2 ${
                  index === 0 ? "border-brand-200 bg-brand-50 text-brand-700" : "border-slate-100 bg-slate-50"
                }`}
              >
                <span className="font-semibold">{index + 1}.</span> {step}
              </li>
            ))}
          </ol>
        ) : null}

        {error ? (
          <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
            {errorCode === "insufficient_credits" ? (
              <a href="#pricing" className="ml-2 font-semibold underline underline-offset-2">
                요금제 보기
              </a>
            ) : null}
          </div>
        ) : null}

        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          원문에 없는 사실은 만들지 않도록 프롬프트를 제한합니다. 발행 전 사실 확인은 필요합니다.
        </p>
      </form>

      {result ? (
        <div id="result" className="mt-6 scroll-mt-24 animate-fade-up">
          {result.video ? <VideoResultView result={result} /> : null}
          {result.draft ? <ResultView result={result} /> : null}
        </div>
      ) : null}
    </div>
  );
}
