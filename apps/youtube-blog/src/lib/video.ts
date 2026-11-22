import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { aspectPreset } from "@tae/video";
import { cuesFromStoryboard, subtitleSet } from "@tae/video";
import type { AspectRatio, Storyboard, SubtitleSet } from "@tae/video";

import { AppError } from "./app-error";

export interface VideoRuntimeConfig {
  mode: "worker" | "inline" | "disabled";
  workerUrl: string | null;
  token: string | null;
  outputDir: string;
}

/** 영상 렌더는 서버리스에서 못 하므로 워커(VIDEO_WORKER_URL) 또는 로컬 인라인 모드로 나뉩니다. */
export function getVideoConfig(): VideoRuntimeConfig {
  const workerUrl = process.env.VIDEO_WORKER_URL?.trim().replace(/\/$/, "") || null;
  const token = process.env.VIDEO_WORKER_TOKEN?.trim() || null;
  const outputDir = process.env.VIDEO_OUTPUT_DIR?.trim() || path.join(process.cwd(), ".video-output");
  const inlineAllowed = process.env.VIDEO_INLINE === "1" || process.env.NODE_ENV !== "production";

  if (workerUrl) return { mode: "worker", workerUrl, token, outputDir };
  if (inlineAllowed) return { mode: "inline", workerUrl: null, token, outputDir };
  return { mode: "disabled", workerUrl: null, token, outputDir };
}

export interface VideoPackage {
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
  /** 실제 제품·공간 사진 참조 수·이름 */
  references?: { count: number; labels: string[] };
  subtitles: { srt: string; ass: string; cueCount: number; source: SubtitleSet["source"] };
  render: { available: boolean; mode: VideoRuntimeConfig["mode"]; reason: string | null };
}

/** 스토리보드에서 바로 복사·다운로드할 수 있는 자막과 렌더 가능 여부를 붙입니다. */
export function buildVideoPackage(storyboard: Storyboard, config: VideoRuntimeConfig = getVideoConfig()): VideoPackage {
  const preset = aspectPreset(storyboard.aspectRatio);
  const cues = cuesFromStoryboard(storyboard, preset);
  const subtitles = subtitleSet(cues, preset, { source: "aligned", provider: "fallback", title: storyboard.title });

  return {
    aspectRatio: storyboard.aspectRatio,
    preset: {
      id: preset.id,
      label: preset.label,
      width: preset.width,
      height: preset.height,
      sceneMin: preset.scenes.min,
      sceneMax: preset.scenes.max,
      durationMin: preset.durationSeconds.min,
      durationMax: preset.durationSeconds.max,
      totalSeconds: Math.round(storyboard.totalDurationMs / 1000),
    },
    storyboard,
    ...(storyboard.references && storyboard.references.length > 0
      ? {
          references: {
            count: storyboard.references.length,
            labels: storyboard.references.map((reference) => reference.label),
          },
        }
      : {}),
    subtitles: {
      srt: subtitles.srt,
      ass: subtitles.ass,
      cueCount: cues.length,
      source: subtitles.source,
    },
    render:
      config.mode === "disabled"
        ? {
            available: false,
            mode: "disabled",
            reason:
              "이 서버에서는 MP4 렌더를 실행할 수 없습니다. apps/video-worker를 배포하고 VIDEO_WORKER_URL을 설정하면 렌더·다운로드가 켜집니다.",
          }
        : { available: true, mode: config.mode, reason: null },
  };
}

// ── 렌더 작업 ────────────────────────────────────────────────────────────

export type VideoJobStatus = "queued" | "running" | "succeeded" | "failed" | "unavailable";

export interface VideoJobView {
  jobId: string;
  status: VideoJobStatus;
  stage: string;
  progress: number;
  mode: VideoRuntimeConfig["mode"];
  aspectRatio: AspectRatio;
  title: string;
  durationMs: number | null;
  video: { bytes: number; durationSeconds: number; renderer: "ffmpeg" | "none" } | null;
  files: VideoFiles;
  warnings: string[];
  error: string | null;
}

export interface VideoFiles {
  mp4: string | null;
  srt: string | null;
  ass: string | null;
  storyboard: string | null;
}

interface InlineJobRecord {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string;
  progress: number;
  aspectRatio: AspectRatio;
  title: string;
  quality: "preview" | "final";
  createdAt: string;
  updatedAt: string;
  durationMs: number | null;
  video: { bytes: number; durationSeconds: number; renderer: "ffmpeg" | "none" } | null;
  files: VideoFiles;
  warnings: string[];
  error: string | null;
}

const ALLOWED_FILES = new Set(["video.mp4", "subtitles.srt", "subtitles.ass", "storyboard.json"]);

/** 렌더 작업을 시작합니다. 워커가 설정돼 있으면 워커에, 아니면 이 프로세스에서 비동기로 돌립니다. */
export async function startVideoRender(
  storyboard: Storyboard,
  options: { quality?: "preview" | "final"; config?: VideoRuntimeConfig } = {},
): Promise<{ jobId: string; mode: VideoRuntimeConfig["mode"]; status: VideoJobStatus }> {
  const config = options.config ?? getVideoConfig();
  const quality = options.quality ?? "final";

  if (config.mode === "disabled") {
    throw new AppError(
      "video_render_unavailable",
      "이 서버에서는 MP4 렌더를 실행할 수 없습니다. 영상 워커를 배포한 뒤 다시 시도해 주세요.",
      503,
    );
  }

  if (config.mode === "worker") {
    const response = await fetch(`${config.workerUrl}/v1/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({
        storyboard,
        quality,
        ...(storyboard.references && storyboard.references.length > 0
          ? { referenceImages: storyboard.references.filter((reference) => reference.url) }
          : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch((error: unknown) => {
      throw new AppError(
        "video_render_unavailable",
        `영상 워커에 연결하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
        503,
      );
    });

    const payload = (await response.json().catch(() => null)) as
      | { job?: { id?: string }; error?: { message?: string } }
      | null;

    if (!response.ok || !payload?.job?.id) {
      throw new AppError(
        "video_render_unavailable",
        payload?.error?.message ?? `영상 워커가 요청을 거부했습니다(HTTP ${response.status}).`,
        response.status >= 500 ? 502 : 400,
      );
    }

    return { jobId: payload.job.id, mode: "worker", status: "queued" };
  }

  return startInlineRender(storyboard, quality, config);
}

async function startInlineRender(
  storyboard: Storyboard,
  quality: "preview" | "final",
  config: VideoRuntimeConfig,
): Promise<{ jobId: string; mode: "inline"; status: VideoJobStatus }> {
  const jobId = randomUUID();
  const dir = path.join(config.outputDir, jobId);
  const now = new Date().toISOString();

  const record: InlineJobRecord = {
    id: jobId,
    status: "running",
    stage: "시작",
    progress: 0.01,
    aspectRatio: storyboard.aspectRatio,
    title: storyboard.title,
    quality,
    createdAt: now,
    updatedAt: now,
    durationMs: null,
    video: null,
    files: { mp4: null, srt: null, ass: null, storyboard: null },
    warnings: [],
    error: null,
  };

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "job.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");

  // 서버리스에서는 이 Promise가 응답 후 죽습니다. VIDEO_INLINE은 로컬/상주 서버용입니다.
  void (async () => {
    let lastWrite = 0;
    try {
      const { runVideoPipeline } = await import("@tae/video");
      const result = await runVideoPipeline({
        source: {
          sourceType: storyboard.source.type,
          title: storyboard.source.title,
          author: storyboard.source.author,
          ...(storyboard.source.url ? { url: storyboard.source.url } : {}),
          text: "",
          language: storyboard.language,
        },
        aspectRatio: storyboard.aspectRatio,
        outputDir: dir,
        storyboard,
        quality,
        onProgress: (value, stage) => {
          record.progress = Math.round(value * 100) / 100;
          record.stage = stage;
          record.status = "running";
          const nowMs = Date.now();
          if (nowMs - lastWrite > 1_000 || value >= 1) {
            lastWrite = nowMs;
            record.updatedAt = new Date(nowMs).toISOString();
            void writeFile(path.join(dir, "job.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
          }
        },
      });

      record.status = result.status === "succeeded" ? "succeeded" : "failed";
      record.stage = result.status === "succeeded" ? "완료" : "MP4 없음";
      record.progress = 1;
      record.durationMs = result.durationMs;
      record.video =
        result.status === "succeeded"
          ? { bytes: result.videoBytes, durationSeconds: result.videoDurationSeconds, renderer: "ffmpeg" }
          : null;
      record.files = {
        mp4: result.files.video ? path.basename(result.files.video) : null,
        srt: path.basename(result.files.srt),
        ass: path.basename(result.files.ass),
        storyboard: path.basename(result.files.storyboard),
      };
      record.warnings = result.warnings;
      record.error = result.status === "succeeded" ? null : (result.warnings.at(-1) ?? "MP4를 만들지 못했습니다.");
    } catch (error) {
      record.status = "failed";
      record.stage = "실패";
      record.progress = 1;
      record.error = error instanceof Error ? error.message : String(error);
    } finally {
      record.updatedAt = new Date().toISOString();
      await writeFile(path.join(dir, "job.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8").catch(() => undefined);
    }
  })();

  return { jobId, mode: "inline", status: "queued" };
}

export async function getVideoJob(jobId: string, config: VideoRuntimeConfig = getVideoConfig()): Promise<VideoJobView | null> {
  if (!isUuid(jobId)) return null;

  if (config.mode === "worker") {
    const response = await fetch(`${config.workerUrl}/v1/jobs/${jobId}`, {
      headers: config.token ? { authorization: `Bearer ${config.token}` } : {},
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (!response || !response.ok) return null;
    const payload = (await response.json().catch(() => null)) as
      | {
          job?: {
            id: string;
            status: "queued" | "running" | "succeeded" | "failed";
            stage: string;
            progress: number;
            aspectRatio: AspectRatio;
            title: string;
            durationMs: number | null;
            video: { bytes: number; durationSeconds: number; renderer: "ffmpeg" | "none" } | null;
            files: { video: string | null; srt: string | null; ass: string | null; storyboard: string | null };
            warnings: string[];
            error: string | null;
          };
        }
      | null;

    const job = payload?.job;
    if (!job) return null;

    return {
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      mode: "worker",
      aspectRatio: job.aspectRatio,
      title: job.title,
      durationMs: job.durationMs,
      video: job.video,
      files: {
        mp4: fileUrl(job.id, "video.mp4", job.files.video),
        srt: fileUrl(job.id, "subtitles.srt", job.files.srt),
        ass: fileUrl(job.id, "subtitles.ass", job.files.ass),
        storyboard: fileUrl(job.id, "storyboard.json", job.files.storyboard),
      },
      warnings: job.warnings,
      error: job.error,
    };
  }

  const record = await readInlineRecord(jobId, config);
  if (!record) return null;

  return {
    jobId: record.id,
    status: record.status,
    stage: record.stage,
    progress: record.progress,
    mode: "inline",
    aspectRatio: record.aspectRatio,
    title: record.title,
    durationMs: record.durationMs,
    video: record.video,
    files: {
      mp4: record.files.mp4 ? fileUrl(record.id, "video.mp4", record.files.mp4) : null,
      srt: record.files.srt ? fileUrl(record.id, "subtitles.srt", record.files.srt) : null,
      ass: record.files.ass ? fileUrl(record.id, "subtitles.ass", record.files.ass) : null,
      storyboard: record.files.storyboard ? fileUrl(record.id, "storyboard.json", record.files.storyboard) : null,
    },
    warnings: record.warnings,
    error: record.error,
  };
}

function fileUrl(jobId: string, name: string, present: string | null): string | null {
  if (!present) return null;
  return `/api/video/file?jobId=${jobId}&name=${name}`;
}

export interface VideoFile {
  body: ArrayBuffer;
  contentType: string;
  size: number;
}

/** 렌더 산출물을 읽습니다(로컬 인라인) 또는 워커에서 중계합니다. */
export async function readVideoFile(
  jobId: string,
  name: string,
  config: VideoRuntimeConfig = getVideoConfig(),
): Promise<VideoFile | null> {
  if (!isUuid(jobId) || !ALLOWED_FILES.has(name)) return null;

  if (config.mode === "worker") {
    const response = await fetch(`${config.workerUrl}/v1/jobs/${jobId}/files/${name}`, {
      headers: config.token ? { authorization: `Bearer ${config.token}` } : {},
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!response || !response.ok) return null;

    const body = await response.arrayBuffer();
    return {
      body,
      contentType: response.headers.get("content-type") ?? contentTypeFor(name),
      size: body.byteLength,
    };
  }

  const filePath = path.join(config.outputDir, jobId, name);
  const info = await stat(filePath).catch(() => null);
  if (!info || !info.isFile()) return null;
  const body = await readFile(filePath);
  return { body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, contentType: contentTypeFor(name), size: body.length };
}

async function readInlineRecord(jobId: string, config: VideoRuntimeConfig): Promise<InlineJobRecord | null> {
  try {
    const raw = await readFile(path.join(config.outputDir, jobId, "job.json"), "utf8");
    return JSON.parse(raw) as InlineJobRecord;
  } catch {
    return null;
  }
}

export function contentTypeFor(name: string): string {
  switch (name) {
    case "video.mp4":
      return "video/mp4";
    case "subtitles.srt":
      return "application/x-subrip; charset=utf-8";
    case "subtitles.ass":
      return "text/plain; charset=utf-8";
    case "storyboard.json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
