#!/usr/bin/env node
/**
 * youtube-blog ↔ video-worker 스모크 테스트.
 *
 *   BASE_URL=http://127.0.0.1:3100 node scripts/smoke-video.mjs
 *
 * 블로그 원문 → 유튜브 영상(9:16) 스토리보드 → MP4 렌더까지 실제 HTTP로 확인합니다.
 * 로컬에서는 VIDEO_INLINE=1(또는 NODE_ENV≠production)로 서버를 띄우면 인라인 렌더가 동작합니다.
 */
import { readFile } from "node:fs/promises";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const ASPECT = process.argv[2] === "16:9" ? "16:9" : "9:16";
const FIXTURE = new URL("../packages/video/fixtures/demo-source.ko.md", import.meta.url);

async function main() {
  const article = await readFile(FIXTURE, "utf8");
  const cookies = new Map();

  const call = async (pathname, body) => {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookies.size > 0 ? { cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    for (const header of response.headers.getSetCookie?.() ?? []) {
      const [pair] = header.split(";");
      const [key, value] = (pair ?? "").split("=");
      if (key && value) cookies.set(key, value);
    }

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // 파일 응답은 text로 확인합니다.
    }
    return { status: response.status, json, text, headers: response.headers };
  };

  const health = await call("/api/health");
  console.log("health:", health.status, health.json?.services ?? health.text.slice(0, 120));
  if (health.status !== 200) throw new Error("서버가 healthy 상태가 아닙니다.");

  // 1) 텍스트 결과 (블로그 원문 → 인스타)
  const textResult = await call("/api/convert", {
    sourceType: "blog",
    text: article,
    format: "instagram",
    language: "ko",
  });
  if (textResult.status !== 200 || !textResult.json?.draft) {
    throw new Error(`텍스트 변환 실패: ${textResult.status} ${textResult.text.slice(0, 300)}`);
  }
  console.log(
    "text:",
    textResult.json.format,
    `slides=${textResult.json.draft.slides?.length}`,
    `provider=${textResult.json.meta.provider}`,
    `credits=${textResult.json.credits.remaining}`,
  );

  // 2) 영상 스토리보드
  const videoResult = await call("/api/convert", {
    sourceType: "blog",
    text: article,
    format: "youtube_video",
    aspectRatio: ASPECT,
    language: "ko",
  });
  if (videoResult.status !== 200 || !videoResult.json?.video) {
    throw new Error(`영상 기획 실패: ${videoResult.status} ${videoResult.text.slice(0, 300)}`);
  }

  const { video, meta } = videoResult.json;
  console.log(
    "storyboard:",
    `${video.preset.label}`,
    `scenes=${video.storyboard.scenes.length}`,
    `seconds=${video.preset.totalSeconds}`,
    `cues=${video.subtitles.cueCount}`,
    `render=${video.render.mode}`,
    `model=${meta.model}`,
  );

  if (!video.render.available) {
    console.log("render unavailable:", video.render.reason);
    return;
  }

  // 3) 렌더 시작 → 폴링
  const started = await call("/api/video/render", { storyboard: video.storyboard, quality: "final" });
  if (started.status !== 202 || !started.json?.jobId) {
    throw new Error(`렌더 시작 실패: ${started.status} ${started.text.slice(0, 300)}`);
  }
  console.log("render job:", started.json.jobId, started.json.mode);

  let job = null;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const status = await call(`/api/video/status?jobId=${started.json.jobId}`);
    job = status.json?.job ?? null;
    if (!job) throw new Error(`상태 조회 실패: ${status.status}`);
    process.stdout.write(`\r  ${job.status} ${Math.round(job.progress * 100)}% ${job.stage}      `);
    if (job.status === "succeeded" || job.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log("");

  if (!job || job.status !== "succeeded" || !job.files.mp4) {
    throw new Error(`렌더 실패: ${job?.error ?? "시간 초과"}`);
  }

  console.log(
    "video:",
    job.files.mp4,
    `${Math.round((job.video?.bytes ?? 0) / 1024)}KB`,
    `${job.video?.durationSeconds}s`,
    job.video?.renderer,
  );

  const file = await fetch(`${BASE_URL}${job.files.mp4}`, {
    headers: { cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ") },
  });
  const bytes = await file.arrayBuffer();
  console.log("download:", file.status, file.headers.get("content-type"), `${Math.round(bytes.byteLength / 1024)}KB`);
  if (file.status !== 200 || bytes.byteLength < 10_000) throw new Error("MP4 다운로드가 비어 있습니다.");

  const srt = await fetch(`${BASE_URL}${job.files.srt}`, {
    headers: { cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ") },
  });
  const srtText = await srt.text();
  console.log("srt:", srt.status, srtText.split("\n")[1]);
  console.log("\nOK");
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
