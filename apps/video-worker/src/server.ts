import { createVideoWorker } from "@tae/video/worker";

/**
 * 영상 렌더 워커 진입점.
 *
 * Vercel 서버리스는 ffmpeg 렌더(수십 초~수 분)를 돌릴 수 없습니다.
 * 이 앱을 Railway / Fly.io / Cloud Run에 배포하고 youtube-blog에
 * VIDEO_WORKER_URL·VIDEO_WORKER_TOKEN을 설정하면 MP4 렌더가 켜집니다.
 */
const port = Number(process.env.PORT ?? 8080);
const outputDir = process.env.VIDEO_OUTPUT_DIR?.trim() || "/data/video-jobs";
const token = process.env.VIDEO_WORKER_TOKEN?.trim();
const concurrentJobs = Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 1);

async function main() {
  const worker = await createVideoWorker({
    outputDir,
    ...(token ? { token } : {}),
    concurrentJobs,
    port,
    host: "0.0.0.0",
  });

  const { url } = await worker.listen();
  console.log(`[video-worker] listening on ${url} (dir=${outputDir}, concurrency=${concurrentJobs})`);
  if (!token) console.log("[video-worker] 경고: VIDEO_WORKER_TOKEN이 없어 인증 없이 열려 있습니다.");

  const shutdown = async (signal: string) => {
    console.log(`[video-worker] ${signal} 수신, 종료합니다.`);
    await worker.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("[video-worker] 시작 실패", error);
  process.exit(1);
});
