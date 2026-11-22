"use client";

import { useEffect, useState } from "react";

import {
  FORMAT_META,
  draftFormats,
  draftOf,
  type ConvertRequestPayload,
  type ConvertResult,
  type TextFormat,
} from "@/lib/api-types";
import type { ArchiveItem } from "@/lib/archive";
import { copyToClipboard, downloadTextFile, formatRelative } from "@/lib/client-file";
import { draftToDownload, draftToPlainText } from "@/lib/format-export";

import { ArrowIcon, CopyIcon, DownloadIcon, TrashIcon } from "./app-icons";

interface ServerJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  title: string | null;
  formats: string[] | null;
  hasResult: boolean;
  creditsCharged: number;
  createdAt: string;
}

export function LibraryView({
  items,
  viewer,
  onOpen,
  onRemove,
  onClear,
  onNavigate,
}: {
  items: ArchiveItem[];
  viewer: { id: string; isGuest: boolean; email: string | null } | null;
  onOpen: (item: ArchiveItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onNavigate: (tab: "studio" | "credits") => void;
}) {
  const [serverJobs, setServerJobs] = useState<ServerJob[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs?limit=30", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { jobs?: ServerJob[] } | null) => {
        if (!cancelled && data?.jobs) setServerJobs(data.jobs);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [items.length]);

  async function copyItem(item: ArchiveItem) {
    const draft = item.result.draft ?? firstDraft(item);
    if (!draft) return;
    const ok = await copyToClipboard(draftToPlainText(draft));
    setCopied(ok ? item.id : null);
    window.setTimeout(() => setCopied(null), 1_500);
  }

  function downloadItem(item: ArchiveItem) {
    const draft = item.result.draft ?? firstDraft(item);
    if (!draft) {
      if (item.result.video) downloadTextFile("storyboard.json", JSON.stringify(item.result.video.storyboard, null, 2), "application/json");
      return;
    }
    const file = draftToDownload(draft);
    downloadTextFile(file.fileName, file.content, file.mimeType);
  }

  /** 서버에 저장된 내 작업을 다시 열어 스튜디오 결과 화면으로 넘깁니다. */
  async function openServerJob(job: ServerJob) {
    if (!job.hasResult) {
      setServerError("이 작업은 예전에 만들어져 결과 원문이 저장되어 있지 않습니다. 요약만 확인할 수 있어요.");
      window.setTimeout(() => setServerError(null), 4_000);
      return;
    }
    setOpeningId(job.id);
    setServerError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { result?: ConvertResult | null; error?: { message?: string } };
      if (!response.ok || !data.result) {
        setServerError(data.error?.message ?? "결과를 불러오지 못했습니다.");
        return;
      }
      const result = data.result;
      onOpen(serverItemFrom(job, result));
    } catch {
      setServerError("결과를 불러오지 못했습니다. 연결을 확인해 주세요.");
    } finally {
      setOpeningId(null);
    }
  }

  const localJobIds = new Set(items.map((item) => item.jobId));
  const serverOnly = serverJobs.filter((job) => !localJobIds.has(job.id));

  return (
    <div className="container-page py-4 lg:py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">보관함</h1>
            <p className="mt-1 text-sm text-slate-500">
              {viewer && !viewer.isGuest
                ? `${viewer.email ?? "내 계정"}의 작업과 이 기기에 저장된 결과입니다.`
                : "이 기기에 저장된 결과입니다. 로그인하면 계정 보관함에 남습니다."}
            </p>
          </div>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="flex-none rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 hover:text-rose-600"
            >
              기기 기록 삭제
            </button>
          ) : null}
        </div>

        {serverError ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] font-semibold text-amber-800" role="status">
            {serverError}
          </p>
        ) : null}

        {items.length === 0 && serverOnly.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 px-5 py-14 text-center">
            <span className="text-4xl" aria-hidden>
              🗂️
            </span>
            <div>
              <p className="text-sm font-bold text-ink">아직 저장된 결과가 없어요</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                스튜디오에서 원문 하나를 넣으면 영상·블로그·인스타·페이스북이 여기에 쌓입니다.
              </p>
            </div>
            <button type="button" onClick={() => onNavigate("studio")} className="btn-primary !py-2.5 text-xs">
              스튜디오에서 만들기
            </button>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-brand-50 text-brand-700">
                    {item.sourceType === "youtube" ? "▶️" : item.sourceType === "instagram" ? "📸" : "📄"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      className="block w-full truncate text-left text-sm font-bold text-ink hover:text-brand-700"
                      title={item.title}
                    >
                      {item.title}
                    </button>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {item.author || "원문"} · {formatRelative(item.savedAt)} · 크레딧 {item.creditsCharged} 사용
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.formats.map((format) => (
                        <span key={format} className="chip !text-[10px]">
                          {FORMAT_META[format].icon} {FORMAT_META[format].short}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white"
                  >
                    열기 <ArrowIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyItem(item)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <CopyIcon className="h-3.5 w-3.5" /> {copied === item.id ? "복사됨 ✓" : "복사"}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadItem(item)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" /> 저장
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    aria-label={`${item.title} 삭제`}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-400 hover:text-rose-600"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {serverOnly.length > 0 ? (
          <section className="card p-4">
            <div className="flex items-center justify-between">
              <p className="section-title !text-sm">계정 보관함</p>
              <span className="text-[11px] text-slate-400">최근 {serverOnly.length}건</span>
            </div>
            <ul className="mt-2 divide-y divide-slate-100">
              {serverOnly.map((job) => (
                <li key={job.id} className="flex items-center gap-2 py-2.5 text-[11px]">
                  <span
                    className={`h-1.5 w-1.5 flex-none rounded-full ${
                      job.status === "succeeded"
                        ? "bg-emerald-500"
                        : job.status === "failed"
                          ? "bg-rose-500"
                          : "bg-amber-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-700">{job.title ?? "제목 없음"}</p>
                    <p className="truncate text-[10px] text-slate-400">
                      {job.formats ? job.formats.map((format) => formatLabel(format)).join("·") : "작업"} ·{" "}
                      {formatRelative(job.createdAt)} · 크레딧 {job.creditsCharged}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={openingId === job.id}
                    onClick={() => void openServerJob(job)}
                    className="flex-none rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {openingId === job.id ? "여는 중…" : job.hasResult ? "열기" : "요약"}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              계정 보관함은 로그인한 계정에만 보이고, 다른 회원의 작업은 열 수 없습니다.
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function serverItemFrom(job: ServerJob, result: ConvertResult): ArchiveItem {
  const formats = result.video ? (["youtube_video"] as const) : draftFormats(result);
  const request: ConvertRequestPayload = {
    sourceType: result.source.sourceType,
    language: "ko",
    ...(result.source.url ? { url: result.source.url } : {}),
  };
  return {
    id: `server-${job.id}`,
    groupKey: job.id,
    jobId: job.id,
    savedAt: job.createdAt,
    title: result.source.title || job.title || "제목 없음",
    author: result.source.author,
    sourceType: result.source.sourceType,
    url: result.source.url,
    formats: [...formats],
    creditsCharged: job.creditsCharged,
    request,
    result,
  };
}

function firstDraft(item: ArchiveItem) {
  for (const format of ["blog", "instagram", "facebook"] as TextFormat[]) {
    const draft = draftOf(item.result, format);
    if (draft) return draft;
  }
  return null;
}

function formatLabel(format: string): string {
  if (format === "youtube_video") return "영상";
  if (format === "blog" || format === "instagram" || format === "facebook") return FORMAT_META[format].short;
  return format;
}
