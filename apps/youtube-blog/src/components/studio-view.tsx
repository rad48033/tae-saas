"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { SourceType } from "@tae/ai";
import type { AspectRatio } from "@tae/video";

import {
  type ConvertRequestPayload,
  type ConvertResult,
  type CreditCosts,
  type Language,
  type TextFormat,
} from "@/lib/api-types";
import { availableFormats } from "@/lib/results";

import { ResultTabs } from "./result-tabs";

type InputMode = "youtube" | "blog" | "instagram" | "upload" | "direct";
type Target = "reel" | "wide" | "text";

const SOURCES: { id: InputMode; label: string; icon: string; sourceType: SourceType }[] = [
  { id: "youtube", label: "유튜브 링크", icon: "▶️", sourceType: "youtube" },
  { id: "blog", label: "블로그 글", icon: "📄", sourceType: "blog" },
  { id: "instagram", label: "인스타 글", icon: "📸", sourceType: "instagram" },
  { id: "upload", label: "영상 파일", icon: "⬆️", sourceType: "blog" },
  { id: "direct", label: "직접 입력", icon: "✍️", sourceType: "blog" },
];

const MIN_TEXT: Record<InputMode, number> = { youtube: 200, blog: 40, instagram: 40, upload: 40, direct: 40 };

const UPLOAD_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-m4v,audio/mpeg,audio/mp4,audio/wav,audio/x-m4a";
const UPLOAD_MAX_BYTES = 24 * 1024 * 1024;

const TARGETS: { id: Target; icon: string; title: string; hint: string; aspect?: AspectRatio }[] = [
  { id: "reel", icon: "📱", title: "9:16 릴스", hint: "1080×1920 · 45~60초 · 5~8장면", aspect: "9:16" },
  { id: "wide", icon: "🖥️", title: "16:9 가로", hint: "1920×1080 · 90~180초 · 8~12장면", aspect: "16:9" },
  { id: "text", icon: "📝", title: "글 3종만", hint: "블로그 · 인스타 10장 · 페이스북 20줄", aspect: undefined },
];

const VIDEO_STAGES = ["스토리보드 구성", "AI 이미지 생성", "음성 합성", "자막 추출", "영상 합치기"];
const TEXT_STAGES = ["원문 확인", "내용 구조화", "초안 작성", "검증"];

export function StudioView({
  costs,
  credits,
  aiMode,
  videoMode,
  result,
  request,
  onResult,
  onCredits,
  onNavigate,
}: {
  costs: CreditCosts;
  credits: number | null;
  aiMode: string;
  videoMode: "worker" | "inline" | "disabled";
  result: ConvertResult | null;
  request: ConvertRequestPayload | null;
  onResult: (result: ConvertResult, request: ConvertRequestPayload) => void;
  onCredits: (credits: number) => void;
  onNavigate: (tab: "credits" | "library" | "settings") => void;
}) {
  const [mode, setMode] = useState<InputMode>("youtube");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Target>("text");
  const [language, setLanguage] = useState<Language>("ko");
  const [keyword, setKeyword] = useState("");
  const [audience, setAudience] = useState("");
  const [referenceImages, setReferenceImages] = useState("");
  const [showOptions, setShowOptions] = useState(false);

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<{
    message: string;
    code?: string;
    details?: Record<string, unknown> | null;
  } | null>(null);
  const [lastPayload, setLastPayload] = useState<ConvertRequestPayload | null>(null);
  const [allowDescription, setAllowDescription] = useState(false);
  const [upload, setUpload] = useState<{ name: string; size: number } | null>(null);
  const [uploadStage, setUploadStage] = useState<"idle" | "signing" | "uploading" | "transcribing">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [transcribingReel, setTranscribingReel] = useState(false);

  const isVideoTarget = target !== "text";
  const videoAllowed = mode !== "youtube";
  const referenceUrls = useMemo(
    () =>
      referenceImages
        .split(/[\n,\s]+/)
        .map((value) => value.trim())
        .filter((value) => /^https?:\/\//i.test(value))
        .slice(0, 6),
    [referenceImages],
  );

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      setElapsed(seconds);
      const maxStage = isVideoTarget ? 1 : 2;
      setStage(Math.min(maxStage, Math.floor(seconds / 5)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [busy, isVideoTarget]);

  useEffect(() => {
    if (!videoAllowed && isVideoTarget) setTarget("text");
  }, [videoAllowed, isVideoTarget]);

  const pasted = text.trim();
  const canSubmit = useMemo(() => {
    if (mode !== "direct" && mode !== "upload" && url.trim().length > 0) return true;
    return pasted.length >= MIN_TEXT[mode];
  }, [mode, url, pasted]);

  const costLabel = isVideoTarget ? `${costs.videoStoryboard}크레딧 기획` : `${costs.textSet}크레딧`;
  const costTotal = isVideoTarget ? costs.videoStoryboard : costs.textSet;

  function buildPayload(overrides: Partial<ConvertRequestPayload> = {}): ConvertRequestPayload {
    const sourceType: SourceType = mode === "direct" || mode === "upload" ? "blog" : SOURCES.find((entry) => entry.id === mode)!.sourceType;
    const base: ConvertRequestPayload = {
      sourceType,
      language,
      ...(mode !== "direct" && mode !== "upload" && url.trim() ? { url: url.trim() } : {}),
      ...(pasted
        ? sourceType === "youtube"
          ? { transcript: pasted }
          : { text: pasted }
        : {}),
      ...(keyword.trim() ? { focusKeyword: keyword.trim() } : {}),
      ...(audience.trim() ? { audience: audience.trim() } : {}),
      ...(isVideoTarget && referenceUrls.length > 0 ? { referenceImages: referenceUrls } : {}),
      ...(allowDescription && sourceType === "youtube" ? { allowDescriptionFallback: true } : {}),
      ...(isVideoTarget
        ? { format: "youtube_video" as const, aspectRatio: target === "wide" ? ("16:9" as const) : ("9:16" as const) }
        : { format: "blog" as const, formats: ["blog", "instagram", "facebook"] as TextFormat[] }),
    };
    return { ...base, ...overrides } as ConvertRequestPayload;
  }

  async function generate(payload: ConvertRequestPayload) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setElapsed(0);
    setStage(0);
    setLastPayload(payload);

    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as ConvertResult & {
        error?: {
          code?: string;
          message?: string;
          details?: Record<string, unknown> & { balance?: number };
        };
      };

      if (!response.ok) {
        setError({
          message: data.error?.message ?? "만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
          code: data.error?.code,
          details: data.error?.details ?? null,
        });
        if (typeof data.error?.details?.balance === "number") onCredits(data.error.details.balance);
        return false;
      }

      onResult(data, payload);
      window.setTimeout(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return true;
    } catch {
      setError({ message: "네트워크 오류가 발생했습니다. 연결을 확인하고 다시 시도해 주세요." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setAllowDescription(false);
    await generate(buildPayload());
  }

  /** 실패 화면에서 "다시 시도": 마지막 요청을 그대로 다시 보냅니다. */
  async function retryLast() {
    if (lastPayload) await generate(lastPayload);
  }

  /** 실패 화면에서 "직접 입력으로 전환": 주소 없이 붙여넣은 글만으로 이어갑니다. */
  function switchToManual() {
    setMode("direct");
    setError(null);
    window.setTimeout(() => {
      const field = document.getElementById("source-text");
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      (field as HTMLTextAreaElement | null)?.focus();
    }, 60);
  }

  function switchToUpload() {
    setMode("upload");
    setError(null);
    window.setTimeout(() => document.getElementById("upload-file")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }

  /** 인스타 릴스처럼 캡션이 없을 때 영상 음성으로 대본을 만듭니다. */
  async function transcribeReel() {
    const videoUrl = typeof error?.details?.videoUrl === "string" ? error.details.videoUrl : null;
    if (!videoUrl || transcribingReel) return;
    setTranscribingReel(true);
    try {
      const response = await fetch("/api/video/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl: videoUrl, language }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        text?: string;
        chars?: number;
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      };
      if (!response.ok || !data.text) {
        setError({
          message: data.error?.message ?? "릴스 음성에서 대본을 만들지 못했습니다. 캡션을 붙여넣어 주세요.",
          code: data.error?.code ?? error?.code,
          details: { ...(error?.details ?? {}), ...(data.error?.details ?? {}) },
        });
        return;
      }
      setText(data.text);
      setError(null);
    } catch {
      setError({ message: "네트워크 문제로 릴스 음성을 가져오지 못했습니다.", code: error?.code });
    } finally {
      setTranscribingReel(false);
    }
  }

  /** 영상 파일 → Storage 직접 업로드 → 전사 → 대본 채우기 */
  async function handleFile(file: File) {
    setUploadError(null);
    setUpload({ name: file.name, size: file.size });

    if (file.size > UPLOAD_MAX_BYTES) {
      setUploadError(
        `파일이 너무 큽니다(${Math.round(file.size / 1024 / 1024)}MB). 24MB 이하(약 1~3분 분량)로 올려 주세요.`,
      );
      return;
    }

    try {
      setUploadStage("signing");
      const signResponse = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size }),
      });
      const signed = (await signResponse.json().catch(() => ({}))) as {
        path?: string;
        uploadUrl?: string;
        contentType?: string;
        error?: { message?: string; details?: Record<string, unknown> };
      };
      if (!signResponse.ok || !signed.path || !signed.uploadUrl) {
        setUploadError(signed.error?.message ?? "업로드할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        if (signed.error?.message) setError({ message: signed.error.message, code: "upload_unavailable" });
        return;
      }

      setUploadStage("uploading");
      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "content-type": signed.contentType || file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) {
        setUploadError(`파일 업로드에 실패했습니다(HTTP ${put.status}). 잠시 후 다시 시도해 주세요.`);
        return;
      }

      setUploadStage("transcribing");
      const transcribeResponse = await fetch("/api/video/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: signed.path,
          filename: file.name,
          mimeType: signed.contentType || file.type,
          language,
        }),
      });
      const data = (await transcribeResponse.json().catch(() => ({}))) as {
        text?: string;
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      };
      if (!transcribeResponse.ok || !data.text) {
        setUploadError(data.error?.message ?? "영상에서 대본을 만들지 못했습니다. 직접 입력으로 이어서 만들 수 있습니다.");
        return;
      }

      setText(data.text);
      setError(null);
    } catch {
      setUploadError("업로드 중 네트워크 문제가 발생했습니다. 연결을 확인해 주세요.");
    } finally {
      setUploadStage("idle");
    }
  }

  const madeFormats = availableFormats(result);

  const canTranscribeReel =
    Boolean(error?.details?.videoUrl) &&
    (error?.details?.nextActions as string[] | undefined)?.includes("transcribe") !== false;
  const canUseDescription = Boolean(error?.details?.canUseDescription);

  return (
    <div className="container-page py-4 lg:py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">무엇을 만들까요?</h1>
            <p className="mt-1 text-sm text-slate-500">원문 하나로 영상과 세 채널을 한 번에 만듭니다.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("library")}
            className="hidden flex-none rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 sm:block"
          >
            보관함
          </button>
        </div>

        {aiMode === "demo" ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
            <strong className="font-bold">데모 모드</strong> — AI 키가 설정되지 않아 규칙 기반 초안을 만듭니다. 키를 넣으면
            실제 대본·이미지·음성으로 바뀝니다.
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="card p-4 sm:p-6">
          <fieldset>
            <legend className="label">입력 소스</legend>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar">
              {SOURCES.map((source) => {
                const active = mode === source.id;
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => {
                      setMode(source.id);
                      setError(null);
                    }}
                    aria-pressed={active}
                    className={`source-chip ${active ? "source-chip-on" : "source-chip-off"}`}
                  >
                    <span aria-hidden>{source.icon}</span>
                    {source.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {mode !== "direct" && mode !== "upload" ? (
            <div className="mt-4">
              <label htmlFor="source-url" className="label">
                원문 주소
              </label>
              <input
                id="source-url"
                name="url"
                type="text"
                inputMode="url"
                autoComplete="off"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={
                  mode === "youtube"
                    ? "https://www.youtube.com/watch?v=… 또는 youtu.be/…"
                    : mode === "blog"
                      ? "https://blog.example.com/post/…"
                      : "https://www.instagram.com/p/… 또는 /reel/…"
                }
                className="field"
              />
              {mode === "instagram" ? (
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                  게시물·릴스 주소를 그대로 붙여넣으면 캡션과 사진을 읽어 옵니다. 비공개 계정·삭제된 게시물은 읽을 수 없어
                  캡션 붙여넣기나 영상 파일로 이어가게 안내합니다.
                </p>
              ) : null}
              {mode === "youtube" ? (
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                  서버가 자막을 못 읽는 영상은 &lsquo;스크립트 표시&rsquo; 자막을 붙여넣으면 바로 만들 수 있습니다.
                </p>
              ) : null}
            </div>
          ) : null}

          {mode === "upload" ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <label htmlFor="upload-file" className="label">
                영상·음성 파일 <span className="font-normal normal-case text-slate-400">(mp4·mov·webm·mp3·m4a·wav · 24MB 이하)</span>
              </label>
              <input
                id="upload-file"
                type="file"
                accept={UPLOAD_ACCEPT}
                disabled={uploadStage !== "idle"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                className="mt-1 block w-full cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-night-950 file:px-3 file:py-1.5 file:text-[11px] file:font-bold file:text-white"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {uploadStage === "signing"
                  ? "업로드 준비 중…"
                  : uploadStage === "uploading"
                    ? "파일 올리는 중…"
                    : uploadStage === "transcribing"
                      ? "영상 음성을 대본으로 받아 적는 중…(30초~2분)"
                      : upload
                        ? `${upload.name} · ${formatBytes(upload.size)}`
                        : "파일을 올리면 음성 추출로 대본을 만들고, 그 대본으로 릴스·블로그를 만듭니다. 발음이 흐린 고유명사는 만든 뒤 확인해 주세요."}
              </p>
              {uploadError ? (
                <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-rose-700" role="alert">
                  {uploadError}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4">
            <label htmlFor="source-text" className="label">
              {mode === "youtube"
                ? "자막 붙여넣기"
                : mode === "instagram"
                  ? "캡션·카드 문구"
                  : mode === "upload"
                    ? "영상에서 받아 적은 대본"
                    : "원문 붙여넣기"}
              <span className="ml-1 font-normal normal-case text-slate-400">
                {mode === "direct" ? "(필수)" : mode === "upload" ? "(자동으로 채워짐 · 고칠 수 있어요)" : "(주소를 못 읽을 때)"}
              </span>
            </label>
            <textarea
              id="source-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={mode === "direct" || mode === "upload" ? 8 : 4}
              placeholder={
                mode === "youtube"
                  ? "영상 아래 '…더보기' → '스크립트 표시'를 열어 전체 복사한 뒤 붙여넣으세요."
                  : mode === "blog"
                    ? "글 본문을 그대로 붙여넣으세요. 제목·소제목이 포함되면 더 좋습니다."
                    : mode === "instagram"
                      ? "카드뉴스 각 장의 문구와 캡션을 붙여넣으세요."
                      : mode === "upload"
                        ? "파일을 올리면 대본이 여기에 채워집니다. 직접 고치거나 더 붙여넣어도 됩니다."
                        : "가지고 있는 대본·메모·회의록을 그대로 붙여넣으세요."
              }
              className="field resize-y font-mono text-xs leading-relaxed"
              maxLength={200_000}
            />
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-400">
              <span>주소 또는 {MIN_TEXT[mode]}자 이상의 원문 중 하나가 필요합니다.</span>
              {pasted.length > 0 ? <span className="text-slate-500">{pasted.length.toLocaleString()}자 입력됨</span> : null}
            </p>
          </div>

          <fieldset className="mt-6">
            <legend className="label">무엇을 만들까요</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {TARGETS.map((option) => {
                const disabled = option.id !== "text" && !videoAllowed;
                const active = target === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setTarget(option.id)}
                    aria-pressed={active}
                    className={`rounded-2xl border p-3.5 text-left transition ${
                      active
                        ? "border-brand-500 bg-brand-50/70 ring-2 ring-brand-100"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
                  >
                    <span className="text-lg" aria-hidden>
                      {option.icon}
                    </span>
                    <span className={`mt-1 block text-sm font-bold ${active ? "text-brand-800" : "text-slate-800"}`}>
                      {option.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{option.hint}</span>
                    <span className="mt-2 block text-[11px] font-bold text-slate-400">
                      {option.id === "text" ? `${costs.textSet}크레딧` : `${costs.videoTotal}크레딧`}
                    </span>
                  </button>
                );
              })}
            </div>
            {!videoAllowed ? (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
                유튜브 원문은 이미 영상이라 다시 영상으로 만들지 않습니다. 블로그·인스타·직접 입력으로 영상을 만들 수
                있어요.
              </p>
            ) : null}
            {videoMode === "disabled" && isVideoTarget ? (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
                이 서버에는 영상 워커가 없어 스토리보드·자막까지만 만들고 MP4는 만들 수 없습니다.
              </p>
            ) : null}
          </fieldset>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowOptions((value) => !value)}
              aria-expanded={showOptions}
              className="text-xs font-semibold text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline"
            >
              {showOptions ? "옵션 닫기" : "제품 사진·키워드 옵션"}
            </button>

            {showOptions ? (
              <div className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                {isVideoTarget ? (
                  <div>
                    <label htmlFor="reference-images" className="label">
                      제품 사진 URL <span className="font-normal normal-case text-slate-400">(선택 · 최대 6장)</span>
                    </label>
                    <textarea
                      id="reference-images"
                      value={referenceImages}
                      onChange={(event) => setReferenceImages(event.target.value)}
                      rows={2}
                      placeholder="https://…/제품-박스.jpg (한 줄에 하나씩)"
                      className="field resize-y font-mono text-xs leading-relaxed"
                      maxLength={12_000}
                    />
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                      실제 패키지 사진을 넣으면 AI가 가상의 박스를 그리지 않고 그 색·로고를 장면마다 유지합니다.
                      {referenceUrls.length > 0 ? ` · 현재 ${referenceUrls.length}장 인식` : ""}
                    </p>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="focus-keyword" className="label">
                      1차 키워드
                    </label>
                    <input
                      id="focus-keyword"
                      value={keyword}
                      onChange={(event) => setKeyword(event.target.value)}
                      placeholder="예: 스타트업 100일"
                      className="field"
                      maxLength={80}
                    />
                  </div>
                  <div>
                    <label htmlFor="audience" className="label">
                      타깃 독자
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

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-500">언어</span>
                  <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                    {(["ko", "en"] as const).map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setLanguage(code)}
                        aria-pressed={language === code}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          language === code ? "bg-night-900 text-white" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        {code === "ko" ? "한국어" : "English"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button type="submit" disabled={busy || !canSubmit} className="btn-primary flex-1 whitespace-nowrap px-4 sm:flex-none sm:px-7">
              {busy ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  만드는 중 {elapsed}s
                </>
              ) : (
                <>
                  {isVideoTarget ? "영상 기획 시작" : "콘텐츠 3종 만들기"}
                  <span aria-hidden>→</span>
                </>
              )}
            </button>
            <p className="text-[11px] leading-relaxed text-slate-500 sm:text-xs">
              <strong className="font-bold text-slate-700">{costLabel}</strong>
              {" · "}
              {isVideoTarget ? `MP4 렌더 시 ${costs.videoRender}크레딧 추가` : "3종 동시 생성 · 1~2분"}
            </p>
          </div>

          {credits !== null && credits < costTotal ? (
            <p className="mt-2 text-xs font-medium text-rose-600">
              크레딧이 부족합니다(보유 {credits}).{" "}
              <button type="button" onClick={() => onNavigate("credits")} className="underline underline-offset-2">
                충전하기
              </button>
            </p>
          ) : null}

          {busy ? <StageStepper stages={isVideoTarget ? VIDEO_STAGES : TEXT_STAGES} active={stage} /> : null}

          {error ? (
            <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <p className="font-semibold leading-relaxed">{error.message}</p>

              {error.code === "insufficient_credits" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => onNavigate("credits")} className="btn-primary !py-1.5 text-xs">
                    크레딧 충전하기
                  </button>
                </div>
              ) : (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {canTranscribeReel ? (
                    <button
                      type="button"
                      disabled={transcribingReel}
                      onClick={() => void transcribeReel()}
                      className="btn-primary !py-1.5 text-xs disabled:opacity-50"
                    >
                      {transcribingReel ? "릴스 음성 받아 적는 중…" : "릴스 음성으로 대본 만들기"}
                    </button>
                  ) : null}

                  {canUseDescription ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAllowDescription(true);
                        void generate({ ...(lastPayload ?? buildPayload()), allowDescriptionFallback: true });
                      }}
                      className="btn-primary !py-1.5 text-xs"
                    >
                      영상 설명으로 계속 만들기
                    </button>
                  ) : null}

                  <button type="button" onClick={switchToManual} className="btn-ghost !py-1.5 text-xs">
                    직접 입력으로 전환
                  </button>

                  {error.code !== "stt_unavailable" ? (
                    <button type="button" onClick={switchToUpload} className="btn-ghost !py-1.5 text-xs">
                      영상 파일 올리기
                    </button>
                  ) : null}

                  {lastPayload && error.code !== "insufficient_credits" ? (
                    <button type="button" onClick={() => void retryLast()} className="btn-ghost !py-1.5 text-xs">
                      다시 시도
                    </button>
                  ) : null}
                </div>
              )}

              {error.details && Array.isArray(error.details.attempts) && error.details.attempts.length > 0 ? (
                <details className="mt-2 text-[11px] text-rose-400">
                  <summary className="cursor-pointer">
                    시도한 경로 {error.details.attempts.length}개 보기
                  </summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-[10px] leading-relaxed">
                    {(error.details.attempts as string[]).map((attempt) => (
                      <li key={attempt}>· {attempt}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </form>

        {result ? (
          <div id="result" className="scroll-mt-24 animate-fade-up">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{result.source.title}</p>
                <p className="text-[11px] text-slate-500">
                  {result.source.author || "원문"} · {madeFormats.length}종 완성 · 크레딧 {result.credits.charged} 사용 ·{" "}
                  {result.credits.remaining} 남음
                </p>
              </div>
              <button type="button" onClick={() => onNavigate("library")} className="text-xs font-semibold text-brand-700">
                보관함에서 보기 →
              </button>
            </div>

            <ResultTabs
              result={result}
              request={request}
              costs={costs}
              credits={credits}
              busy={busy}
              videoMode={videoMode}
              onGenerate={generate}
              onCredits={onCredits}
              onNavigate={onNavigate}
            />
          </div>
        ) : null}

        {!result && !busy ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["🎬", "영상", "AI 이미지·음성·자막까지 붙은 MP4"],
              ["📝", "블로그", "2,000자 SEO 글 + FAQ + 태그"],
              ["📱", "인스타·페이스북", "카드 10장, 20줄 피드"],
            ].map(([icon, title, body]) => (
              <div key={title} className="card-flat p-4">
                <span aria-hidden>{icon}</span>
                <p className="mt-1 text-sm font-bold text-ink">{title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{body}</p>
              </div>
            ))}
          </div>
        ) : null}

        <p className="px-1 pb-2 text-[11px] leading-relaxed text-slate-400">
          원문에 없는 사실은 만들지 않도록 프롬프트를 제한합니다. 발행 전 사실 확인은 필요합니다.
        </p>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export function StageStepper({ stages, active }: { stages: string[]; active: number }) {
  return (
    <ol className="mt-4 space-y-1.5" aria-label="진행 단계">
      {stages.map((label, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li
            key={label}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs transition ${
              current
                ? "border-brand-200 bg-brand-50 text-brand-800"
                : done
                  ? "border-slate-100 bg-white text-slate-500"
                  : "border-slate-100 bg-slate-50/60 text-slate-400"
            }`}
          >
            <span
              className={`grid h-5 w-5 flex-none place-items-center rounded-full text-[10px] font-bold ${
                done ? "bg-brand-600 text-white" : current ? "bg-brand-100 text-brand-700" : "bg-slate-200 text-slate-500"
              }`}
            >
              {done ? "✓" : index + 1}
            </span>
            <span className={current ? "font-bold" : undefined}>{label}</span>
            {current ? <span className="ml-auto h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand-500" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
