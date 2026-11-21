"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { ContentDraft, ContentFormat } from "@tae/ai";

import { ResultView } from "./result-view";

type Language = "ko" | "en";

export interface ConvertResult {
  jobId: string;
  format: ContentFormat;
  draft: ContentDraft;
  video: {
    id: string;
    url: string;
    title: string;
    channelTitle: string;
    durationSeconds: number | null;
    thumbnailUrl: string | null;
  };
  credits: { remaining: number; charged: number };
  meta: {
    provider: string;
    model: string;
    mode: "anthropic" | "demo";
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
    transcriptChars: number;
    transcriptLanguage: string;
  };
}

const FORMATS: { id: ContentFormat; icon: string; label: string; hint: string }[] = [
  { id: "blog", icon: "📝", label: "블로그 포스팅", hint: "SEO 제목·메타 설명·목차·본문·태그" },
  { id: "instagram", icon: "📸", label: "인스타 포스팅", hint: "훅 + 카드뉴스 5~7장 + 캡션 + 해시태그" },
  { id: "facebook", icon: "💬", label: "페이스북 포스팅", hint: "스토리텔링 글 + 핵심 불릿 + 질문" },
];

const STEPS = ["영상 정보 확인", "자막 추출", "구조화·검증", "완료"];

export function Converter({ demoMode }: { demoMode: boolean }) {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<ContentFormat>("blog");
  const [language, setLanguage] = useState<Language>("ko");
  const [focusKeyword, setFocusKeyword] = useState("");
  const [audience, setAudience] = useState("");
  const [transcript, setTranscript] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const pastedTranscript = transcript.trim();
    if (pastedTranscript.length > 0 && pastedTranscript.length < 200) {
      setError("붙여넣은 자막이 너무 짧습니다. 200자 이상 넣어 주세요.");
      return;
    }

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
          url,
          format,
          language,
          ...(focusKeyword.trim() ? { focusKeyword: focusKeyword.trim() } : {}),
          ...(audience.trim() ? { audience: audience.trim() } : {}),
          ...(pastedTranscript.length >= 200 ? { transcript: pastedTranscript } : {}),
        }),
      });

      const data = (await response.json()) as ConvertResult & {
        error?: { code?: string; message?: string; details?: { balance?: number } };
      };

      if (!response.ok) {
        setError(data.error?.message ?? "변환에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        setErrorCode(data.error?.code ?? null);
        if (data.error?.code === "transcript_unavailable") setShowAdvanced(true);
        if (typeof data.error?.details?.balance === "number") setCredits(data.error.details.balance);
        return;
      }

      setResult(data);
      setCredits(data.credits.remaining);
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
            <strong className="font-semibold">데모 모드</strong> — ANTHROPIC_API_KEY가 설정되지 않아 규칙 기반 초안을
            만듭니다. 문장·구조 품질은 Claude 연동 후 달라집니다.
          </div>
        ) : null}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex-1">
            <label htmlFor="youtube-url" className="label">
              유튜브 링크
            </label>
            <input
              id="youtube-url"
              name="url"
              type="text"
              inputMode="url"
              autoComplete="off"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=… 또는 youtu.be/…"
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

        <fieldset className="mt-6">
          <legend className="label">발행 형식</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {FORMATS.map((option) => {
              const selected = format === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFormat(option.id)}
                  aria-pressed={selected}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected
                      ? "border-brand-500 bg-brand-50/70 ring-2 ring-brand-100"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-lg" aria-hidden>
                    {option.icon}
                  </span>
                  <span className={`mt-1 block text-sm font-bold ${selected ? "text-brand-800" : "text-slate-800"}`}>
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

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

              <div className="sm:col-span-2">
                <label htmlFor="transcript" className="label">
                  자막 직접 붙여넣기 (선택)
                </label>
                <textarea
                  id="transcript"
                  value={transcript}
                  onChange={(event) => setTranscript(event.target.value)}
                  rows={6}
                  placeholder="유튜브 영상 아래 '…더보기' → '스크립트 표시'를 열어 전체 복사한 뒤 여기에 붙여넣으세요."
                  className="field resize-y font-mono text-xs leading-relaxed"
                  maxLength={200_000}
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                  유튜브가 자동 자막 추출을 막는 경우(비공개·봇 차단) 이 칸을 채우면 바로 만들 수 있습니다. 타임스탬프는
                  자동으로 정리됩니다.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || url.trim().length === 0} className="btn-primary">
            {busy ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                만드는 중… {elapsed}s
              </>
            ) : (
              <>
                콘텐츠 만들기
                <span aria-hidden>→</span>
              </>
            )}
          </button>
          <span className="text-xs text-slate-500">크레딧 1개 사용 · 보통 20~60초</span>
        </div>

        {busy ? (
          <ol className="mt-5 grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
            {STEPS.map((step, index) => (
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
            {errorCode === "transcript_unavailable" ? (
              <button
                type="button"
                onClick={() => document.getElementById("transcript")?.focus()}
                className="ml-2 font-semibold underline underline-offset-2"
              >
                자막 붙여넣기로 이동
              </button>
            ) : null}
          </div>
        ) : null}

        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          자막이 있는 공개 영상만 지원합니다. 자동 추출이 막히면 고급 옵션에서 자막을 직접 붙여넣을 수 있습니다.
        </p>
      </form>

      {result ? (
        <div className="mt-6 animate-fade-up">
          <ResultView result={result} />
        </div>
      ) : null}
    </div>
  );
}
