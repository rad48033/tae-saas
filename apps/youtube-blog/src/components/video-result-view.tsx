"use client";

import { useCallback, useEffect, useState } from "react";

import type { ConvertResult, VideoPackagePayload } from "./converter";
import { CopyButton } from "./copy-button";

interface VideoJobView {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "unavailable";
  stage: string;
  progress: number;
  mode: "worker" | "inline" | "disabled";
  title: string;
  durationMs: number | null;
  video: { bytes: number; durationSeconds: number; renderer: "ffmpeg" | "none" } | null;
  files: { mp4: string | null; srt: string | null; ass: string | null; storyboard: string | null };
  warnings: string[];
  error: string | null;
}

export function VideoResultView({ result }: { result: ConvertResult }) {
  const video = result.video;
  if (!video) return null;

  return <VideoPackageView video={video} result={result} />;
}

function VideoPackageView({ video, result }: { video: VideoPackagePayload; result: ConvertResult }) {
  const { storyboard, preset, subtitles, render } = video;
  const [job, setJob] = useState<VideoJobView | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/video/status?jobId=${encodeURIComponent(jobId)}`).catch(() => null);
    if (!response || !response.ok) return;
    const data = (await response.json()) as { job?: VideoJobView };
    if (data.job) setJob(data.job);
  }, []);

  useEffect(() => {
    if (!job || job.status === "succeeded" || job.status === "failed") return;
    const timer = setInterval(() => void poll(job.jobId), 2_000);
    return () => clearInterval(timer);
  }, [job, poll]);

  async function startRender(quality: "preview" | "final") {
    if (starting) return;
    setStarting(true);
    setError(null);

    try {
      const response = await fetch("/api/video/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storyboard, quality }),
      });
      const data = (await response.json()) as {
        jobId?: string;
        mode?: string;
        status?: string;
        error?: { message?: string };
      };

      if (!response.ok || !data.jobId) {
        setError(data.error?.message ?? "렌더를 시작하지 못했습니다.");
        return;
      }

      setJob({
        jobId: data.jobId,
        status: "queued",
        stage: "대기",
        progress: 0,
        mode: (data.mode as VideoJobView["mode"]) ?? render.mode,
        title: storyboard.title,
        durationMs: null,
        video: null,
        files: { mp4: null, srt: null, ass: null, storyboard: null },
        warnings: [],
        error: null,
      });
    } catch {
      setError("렌더 요청에 실패했습니다. 연결을 확인해 주세요.");
    } finally {
      setStarting(false);
    }
  }

  const narrationScript = storyboard.scenes
    .map((scene) => `[${clock(scene.startMs)}–${clock(scene.endMs)}] ${scene.title}\n${scene.narration}`)
    .join("\n\n");

  return (
    <article className="card mb-6 overflow-hidden">
      <header className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                🎬 유튜브 영상 · {preset.label}
              </span>
              <span className="chip">{result.source.sourceType === "youtube" ? "유튜브" : result.source.sourceType === "blog" ? "블로그" : "인스타"} 원문</span>
              <span className={`chip ${result.meta.mode === "demo" ? "!bg-amber-100 !text-amber-800" : ""}`}>
                {result.meta.mode === "demo" ? "데모 대본" : "Claude 대본"}
              </span>
              <span className="chip">
                크레딧 {result.credits.charged} 사용 · {result.credits.remaining} 남음
              </span>
              {video.references && video.references.count > 0 ? (
                <span className="chip" title={video.references.labels.join(", ")}>
                  실제 제품 사진 {video.references.count}장 반영
                </span>
              ) : null}
            </div>
            <h3 className="mt-2 text-xl font-extrabold leading-snug tracking-tight text-ink">{storyboard.title}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {preset.width}×{preset.height} · {storyboard.scenes.length}장면 · {preset.totalSeconds}초 · 자막{" "}
              {subtitles.cueCount}컷
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={narrationScript} label="나레이션 복사" />
            <DownloadButton text={subtitles.srt} fileName="subtitles.srt" mime="application/x-subrip" label="SRT 저장" />
            <DownloadButton text={subtitles.ass} fileName="subtitles.ass" mime="text/plain" label="ASS 저장" />
            <DownloadButton
              text={JSON.stringify(storyboard, null, 2)}
              fileName="storyboard.json"
              mime="application/json"
              label="스토리보드"
            />
          </div>
        </div>
      </header>

      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">스토리보드 {storyboard.scenes.length}장면</p>
              <span className="text-[11px] text-slate-400">나레이션 · 화면 문구 · 이미지 프롬프트</span>
            </div>

            <ol className="mt-3 space-y-3">
              {storyboard.scenes.map((scene) => (
                <li key={scene.index} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                      {scene.index}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">
                      {clock(scene.startMs)}–{clock(scene.endMs)} · {(scene.durationMs / 1000).toFixed(1)}초
                    </span>
                    <span className="ml-auto">
                      <CopyButton text={scene.narration} label="나레이션" />
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-slate-900">{scene.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">{scene.narration}</p>
                  {scene.onScreenText ? (
                    <p className="mt-2 inline-flex rounded-lg bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800">
                      화면 문구 · {scene.onScreenText}
                    </p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-medium text-slate-400 hover:text-slate-600">
                      이미지 프롬프트 보기
                    </summary>
                    <p className="mt-1 rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-500">
                      {scene.visualPrompt}
                    </p>
                  </details>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">자막 (SRT)</p>
              <CopyButton text={subtitles.srt} label="SRT 복사" />
            </div>
            <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-[11px] leading-relaxed text-slate-600">
              {subtitles.srt}
            </pre>
            <p className="mt-1.5 text-[11px] text-slate-400">
              렌더 시에는 Whisper STT 타임스탬프(키가 없으면 나레이션 기준 정렬)로 만든 최종 자막이 영상에 태워집니다.
            </p>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">영상 렌더</p>

            {!render.available ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
                {render.reason}
              </p>
            ) : (
              <>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  AI 이미지 → TTS 나레이션 → 자막 → ffmpeg(Ken Burns 줌/팬) 순서로 MP4를 만듭니다. 9:16은 약 1분,
                  16:9는 2~3분 걸립니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void startRender("final")}
                    disabled={starting || (job !== null && job.status !== "succeeded" && job.status !== "failed")}
                    className="btn-primary !px-4 !py-2 text-xs"
                  >
                    {starting ? "시작 중…" : job?.status === "succeeded" ? "다시 렌더" : "MP4 렌더 시작"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void startRender("preview")}
                    disabled={starting || (job !== null && job.status !== "succeeded" && job.status !== "failed")}
                    className="btn-ghost !px-3 !py-2 text-xs"
                    title="절반 해상도로 빠르게 확인"
                  >
                    미리보기 렌더
                  </button>
                </div>

                {error ? (
                  <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-700">
                    {error}
                  </p>
                ) : null}

                {job ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>
                        {job.status === "succeeded" ? "완료" : job.status === "failed" ? "실패" : job.stage}
                      </span>
                      <span>{Math.round(job.progress * 100)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full transition-all ${
                          job.status === "failed" ? "bg-rose-400" : "bg-brand-500"
                        }`}
                        style={{ width: `${Math.max(3, Math.round(job.progress * 100))}%` }}
                      />
                    </div>

                    {job.status === "succeeded" && job.files.mp4 ? (
                      <div className="mt-3 space-y-2">
                        <video
                          controls
                          playsInline
                          preload="metadata"
                          className={`w-full rounded-xl bg-black ${storyboard.aspectRatio === "9:16" ? "max-h-[520px] object-contain" : ""}`}
                          src={job.files.mp4}
                        />
                        <div className="flex flex-wrap gap-2">
                          <a href={`${job.files.mp4}&download=1`} className="btn-ghost !px-3 !py-1.5 text-xs">
                            MP4 다운로드
                          </a>
                          {job.files.srt ? (
                            <a href={`${job.files.srt}&download=1`} className="btn-ghost !px-3 !py-1.5 text-xs">
                              최종 SRT
                            </a>
                          ) : null}
                          {job.files.ass ? (
                            <a href={`${job.files.ass}&download=1`} className="btn-ghost !px-3 !py-1.5 text-xs">
                              최종 ASS
                            </a>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {formatBytes(job.video?.bytes ?? 0)} · {job.video?.durationSeconds ?? 0}초 ·{" "}
                          {job.video?.renderer === "ffmpeg" ? "ffmpeg" : "렌더 없음"}
                        </p>
                      </div>
                    ) : null}

                    {job.status === "failed" ? (
                      <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] leading-relaxed text-rose-700">
                        {job.error ?? "MP4를 만들지 못했습니다."}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">이 구성</p>
            <dl className="mt-2 space-y-1.5 text-[11px] text-slate-600">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">비율</dt>
                <dd>
                  {storyboard.aspectRatio} ({preset.width}×{preset.height})
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">장면</dt>
                <dd>
                  {storyboard.scenes.length}개 (권장 {preset.sceneMin}~{preset.sceneMax})
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">길이</dt>
                <dd>
                  {preset.totalSeconds}초 (목표 {preset.durationMin}~{preset.durationMax})
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">보이스</dt>
                <dd>{storyboard.voice}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">대본</dt>
                <dd>{result.meta.model}</dd>
              </div>
            </dl>
            {storyboard.hashtags.length > 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-brand-600">{storyboard.hashtags.join(" ")}</p>
            ) : null}
          </div>

          {(result.meta.warnings ?? []).length > 0 || result.source.warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
              {[...result.source.warnings, ...(result.meta.warnings ?? [])].map((warning) => (
                <p key={warning}>· {warning}</p>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

function DownloadButton({
  text,
  fileName,
  mime,
  label,
}: {
  text: string;
  fileName: string;
  mime: string;
  label: string;
}) {
  function save() {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" onClick={save} className="btn-ghost !py-1.5 text-xs">
      {label}
    </button>
  );
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
