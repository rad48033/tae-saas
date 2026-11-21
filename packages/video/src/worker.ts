import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { storyboardSchema } from "./storyboard";
import { VideoJobStore, type VideoJobRecord } from "./jobs";
import { runVideoPipeline } from "./pipeline";
import { doctor } from "./renderer/index";
import type { Storyboard } from "./types";

export interface VideoWorkerOptions {
  /** 작업 산출물 루트 (jobId별 하위 폴더) */
  outputDir: string;
  /** 설정하면 Authorization: Bearer <token> 필요 */
  token?: string;
  /** 동시에 렌더할 작업 수 (ffmpeg는 CPU를 많이 씁니다) */
  concurrentJobs?: number;
  port?: number;
  host?: string;
}

export interface VideoWorker {
  server: http.Server;
  store: VideoJobStore;
  listen(): Promise<{ url: string; port: number }>;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".srt": "application/x-subrip; charset=utf-8",
  ".ass": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * 영상 렌더 워커 (Vercel 서버리스 밖에서 도는 긴 작업용 HTTP 서버).
 *
 *   POST /v1/render            { storyboard, quality? } → 202 { job }
 *   GET  /v1/jobs              최근 작업 목록
 *   GET  /v1/jobs/:id          작업 상태
 *   GET  /v1/jobs/:id/files/*  산출물 (video.mp4, subtitles.srt, subtitles.ass, images/*)
 *   GET  /health               ffmpeg·제공자 상태
 *
 * apps/video-worker가 이 서버를 그대로 띄웁니다. 로컬에서는 `pnpm --filter @tae/video worker`.
 */
export async function createVideoWorker(options: VideoWorkerOptions): Promise<VideoWorker> {
  const outputDir = path.resolve(options.outputDir);
  const store = new VideoJobStore(outputDir);
  await store.init();

  const token = options.token?.trim() || process.env.VIDEO_WORKER_TOKEN?.trim() || "";
  const limit = Math.max(1, options.concurrentJobs ?? 1);
  let running = 0;
  const queue: string[] = [];

  const pump = () => {
    while (running < limit && queue.length > 0) {
      const jobId = queue.shift();
      if (!jobId) break;
      running += 1;
      void runJob(jobId).finally(() => {
        running -= 1;
        pump();
      });
    }
  };

  const runJob = async (jobId: string) => {
    const record = store.get(jobId);
    if (!record) return;

    await store.update(jobId, { status: "running", stage: "시작", progress: 0.01 });

    try {
      const result = await runVideoPipeline({
        source: {
          sourceType: record.storyboard.source.type,
          title: record.storyboard.source.title,
          author: record.storyboard.source.author,
          ...(record.storyboard.source.url ? { url: record.storyboard.source.url } : {}),
          text: "",
          language: record.storyboard.language,
        },
        aspectRatio: record.storyboard.aspectRatio,
        outputDir: store.dirFor(jobId),
        storyboard: record.storyboard,
        quality: record.quality,
        onProgress: (value, stage) => {
          void store.update(jobId, { progress: Math.round(value * 100) / 100, stage });
        },
      });

      await store.update(jobId, {
        status: result.status === "succeeded" ? "succeeded" : "failed",
        stage: result.status === "succeeded" ? "완료" : "MP4 없음",
        progress: 1,
        durationMs: result.durationMs,
        files: {
          video: result.files.video ? path.relative(store.dirFor(jobId), result.files.video) : null,
          srt: path.relative(store.dirFor(jobId), result.files.srt),
          ass: path.relative(store.dirFor(jobId), result.files.ass),
          storyboard: path.relative(store.dirFor(jobId), result.files.storyboard),
        },
        video:
          result.status === "succeeded"
            ? {
                bytes: result.videoBytes,
                durationSeconds: result.videoDurationSeconds,
                renderer: result.renderer,
              }
            : null,
        warnings: result.warnings,
        error:
          result.status === "succeeded"
            ? null
            : result.warnings[result.warnings.length - 1] ?? "MP4를 만들지 못했습니다.",
      });
    } catch (error) {
      await store.update(jobId, {
        status: "failed",
        stage: "실패",
        progress: 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: { code: "internal_error", message: String(error) } });
    });
  });

  async function handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/health") {
      const info = await doctor();
      sendJson(response, 200, {
        status: "ok",
        time: new Date().toISOString(),
        ffmpeg: info.ffmpeg ? info.ffmpeg.version : null,
        providers: {
          image: info.imageProvider,
          tts: info.ttsProvider,
          stt: info.sttProvider,
        },
        jobs: { running, queued: queue.length },
      });
      return;
    }

    if (!authorized(request, token)) {
      sendJson(response, 401, { error: { code: "unauthorized", message: "워커 토큰이 필요합니다." } });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/render") {
      const body = await readJson(request);
      const parsed = storyboardSchema.safeParse((body as { storyboard?: unknown }).storyboard);
      if (!parsed.success) {
        sendJson(response, 400, {
          error: { code: "invalid_storyboard", message: "스토리보드 형식이 올바르지 않습니다.", details: parsed.error.issues.slice(0, 8) },
        });
        return;
      }

      const qualityInput = (body as { quality?: unknown }).quality;
      const quality = qualityInput === "preview" ? "preview" : "final";
      const job = await store.create({ storyboard: parsed.data as Storyboard, quality });
      queue.push(job.id);
      pump();
      sendJson(response, 202, { job: publicJob(job) });
      return;
    }

    if (request.method === "GET" && pathname === "/v1/jobs") {
      sendJson(response, 200, { jobs: store.list().map(publicJob) });
      return;
    }

    const fileMatch = /^\/v1\/jobs\/([0-9a-f-]{36})\/files\/(.+)$/.exec(pathname);
    if (request.method === "GET" && fileMatch) {
      const [, jobId, relative] = fileMatch;
      if (!jobId || !relative) {
        sendJson(response, 400, { error: { code: "invalid_request", message: "파일 경로가 올바르지 않습니다." } });
        return;
      }
      await serveFile(response, path.join(store.dirFor(jobId), relative), store.dirFor(jobId));
      return;
    }

    const jobMatch = /^\/v1\/jobs\/([0-9a-f-]{36})$/.exec(pathname);
    if (request.method === "GET" && jobMatch) {
      const job = store.get(jobMatch[1] ?? "");
      if (!job) {
        sendJson(response, 404, { error: { code: "not_found", message: "작업을 찾을 수 없습니다." } });
        return;
      }
      sendJson(response, 200, { job: publicJob(job) });
      return;
    }

    sendJson(response, 404, { error: { code: "not_found", message: "없는 경로입니다." } });
  }

  return {
    server,
    store,
    async listen() {
      const port = options.port ?? Number(process.env.PORT ?? 8080);
      const host = options.host ?? "0.0.0.0";
      await new Promise<void>((resolve) => server.listen(port, host, resolve));
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      return { url: `http://127.0.0.1:${actualPort}`, port: actualPort };
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function authorized(request: http.IncomingMessage, token: string): boolean {
  if (!token) return true;
  const header = request.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = request.headers["x-video-token"];
  return bearer === token || (typeof alt === "string" && alt === token);
}

function publicJob(job: VideoJobRecord) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    aspectRatio: job.aspectRatio,
    title: job.title,
    quality: job.quality,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    durationMs: job.durationMs,
    files: job.files,
    video: job.video,
    warnings: job.warnings,
    error: job.error,
  };
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("요청 본문이 너무 큽니다.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("JSON 본문을 읽지 못했습니다.");
  }
}

async function serveFile(response: http.ServerResponse, filePath: string, rootDir: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(rootDir) + path.sep)) {
    sendJson(response, 403, { error: { code: "forbidden", message: "허용되지 않은 경로입니다." } });
    return;
  }

  const info = await stat(resolved).catch(() => null);
  if (!info || !info.isFile()) {
    sendJson(response, 404, { error: { code: "not_found", message: "파일이 없습니다." } });
    return;
  }

  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": "private, max-age=3600",
  });
  createReadStream(resolved).pipe(response);
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": payload.length });
  response.end(payload);
}
