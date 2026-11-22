"use client";

import { useEffect, useState } from "react";

import {
  type ConvertRequestPayload,
  type ConvertResult,
  type CreditCosts,
  type OutputFormat,
  type TextFormat,
  FORMAT_META,
  draftOf,
} from "@/lib/api-types";

import { ResultView } from "./result-view";
import { VideoResultView } from "./video-result-view";

const TAB_ORDER: OutputFormat[] = ["youtube_video", "blog", "instagram", "facebook"];

export function ResultTabs({
  result,
  request,
  costs,
  credits,
  busy,
  videoMode,
  onGenerate,
  onCredits,
  onNavigate,
}: {
  result: ConvertResult;
  request: ConvertRequestPayload | null;
  costs: CreditCosts;
  credits: number | null;
  busy: boolean;
  videoMode: "worker" | "inline" | "disabled";
  onGenerate: (payload: ConvertRequestPayload) => Promise<boolean>;
  onCredits: (credits: number) => void;
  onNavigate: (tab: "credits" | "library" | "settings") => void;
}) {
  const [active, setActive] = useState<OutputFormat>(result.format);

  useEffect(() => {
    setActive(result.format);
  }, [result.jobId, result.format]);

  const hasVideo = Boolean(result.video);
  const sourceType = result.source.sourceType;
  const videoFromYoutube = sourceType === "youtube";

  function status(format: OutputFormat): { available: boolean; label: string } {
    if (format === "youtube_video") {
      return hasVideo ? { available: true, label: "완성" } : { available: false, label: `${costs.videoStoryboard}크레딧` };
    }
    const draft = draftOf(result, format);
    return draft ? { available: true, label: "완성" } : { available: false, label: `${costs.text}크레딧` };
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50/70 p-1.5 no-scrollbar">
        {TAB_ORDER.map((format) => {
          const meta = FORMAT_META[format];
          const state = status(format);
          const selected = active === format;
          return (
            <button
              key={format}
              type="button"
              onClick={() => setActive(format)}
              aria-pressed={selected}
              className={`flex min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-2 text-xs font-bold transition sm:px-3 sm:text-[13px] ${
                selected ? "bg-white text-ink shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <span aria-hidden>{meta.icon}</span>
              <span className="sm:hidden">{meta.short}</span>
              <span className="hidden sm:inline">{meta.label}</span>
              <span
                className={`hidden rounded-full px-1.5 py-0.5 text-[10px] font-bold sm:inline ${
                  state.available ? "bg-emerald-50 text-emerald-700" : "bg-slate-200/70 text-slate-500"
                }`}
              >
                {state.available ? "완성" : state.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="p-3 sm:p-5">
        {active === "youtube_video" ? (
          hasVideo ? (
            <VideoResultView result={result} costs={costs} onCredits={onCredits} onNavigate={onNavigate} />
          ) : (
            <EmptyTab
              icon="🎬"
              title="영상으로도 만들 수 있어요"
              body={
                videoFromYoutube
                  ? "유튜브 원문은 이미 영상이라 영상으로 다시 만들지 않습니다. 블로그·인스타·직접 입력을 원문으로 넣어 주세요."
                  : `스토리보드·대본·자막을 ${costs.videoStoryboard}크레딧에 만들고, 결과 화면에서 MP4 렌더(${costs.videoRender}크레딧)를 시작합니다.`
              }
              disabled={videoFromYoutube || busy || !request}
              actionLabel={`영상 기획 시작 · ${costs.videoStoryboard}크레딧`}
              onAction={() =>
                request
                  ? void onGenerate({
                      ...request,
                      formats: undefined,
                      format: "youtube_video",
                      aspectRatio: "9:16",
                    })
                  : undefined
              }
              extra={
                videoFromYoutube || !request ? null : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void onGenerate({ ...request, formats: undefined, format: "youtube_video", aspectRatio: "16:9" })
                    }
                    className="btn-ghost !py-2 text-xs"
                  >
                    16:9 가로로
                  </button>
                )
              }
            />
          )
        ) : (
          <TextTab
            result={result}
            request={request}
            format={active}
            costs={costs}
            credits={credits}
            busy={busy}
            onGenerate={onGenerate}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </section>
  );
}

function TextTab({
  result,
  request,
  format,
  costs,
  credits,
  busy,
  onGenerate,
  onNavigate,
}: {
  result: ConvertResult;
  request: ConvertRequestPayload | null;
  format: TextFormat;
  costs: CreditCosts;
  credits: number | null;
  busy: boolean;
  onGenerate: (payload: ConvertRequestPayload) => Promise<boolean>;
  onNavigate: (tab: "credits" | "library" | "settings") => void;
}) {
  const draft = draftOf(result, format);

  if (draft) {
    return <ResultView result={{ ...result, draft, format }} />;
  }

  const meta = FORMAT_META[format];
  const missingSet = (["blog", "instagram", "facebook"] as TextFormat[]).filter((item) => !draftOf(result, item));

  return (
    <EmptyTab
      icon={meta.icon}
      title={`${meta.label} 결과가 아직 없어요`}
      body={`${meta.hint}. 같은 원문으로 ${costs.text}크레딧에 만들 수 있습니다.`}
      disabled={busy || !request}
      actionLabel={`${meta.short} 만들기 · ${costs.text}크레딧`}
      onAction={() => (request ? void onGenerate({ ...request, formats: undefined, format }) : undefined)}
      extra={
        missingSet.length > 1 && request ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onGenerate({ ...request, formats: ["blog", "instagram", "facebook"] })}
            className="btn-ghost !py-2 text-xs"
          >
            남은 {missingSet.length}종 한 번에 · {costs.textSet}크레딧
          </button>
        ) : null
      }
      footer={
        credits !== null && credits < costs.text ? (
          <button type="button" onClick={() => onNavigate("credits")} className="text-xs font-semibold text-rose-600 underline">
            크레딧 충전하기
          </button>
        ) : null
      }
    />
  );
}

function EmptyTab({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  disabled,
  extra,
  footer,
}: {
  icon: string;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  extra?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-5 py-10 text-center">
      <span className="text-3xl" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">{body}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={onAction} disabled={disabled} className="btn-primary !py-2.5 text-xs">
          {actionLabel}
        </button>
        {extra}
      </div>
      {footer}
    </div>
  );
}
