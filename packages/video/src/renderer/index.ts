import { access, writeFile } from "node:fs/promises";
import path from "node:path";

import { detectFfmpeg, buildFfmpegPlan, renderWithFfmpeg, type FfmpegInfo } from "./ffmpeg";
import type { RenderRequest, RenderResult } from "../types";

export { detectFfmpeg, buildFfmpegPlan, type FfmpegInfo, type FfmpegPlan } from "./ffmpeg";

/**
 * ffmpeg가 있으면 실제 MP4를 만들고, 없으면 자산(이미지·음성·자막)과
 * 바로 실행할 수 있는 render.sh를 남깁니다. 조용히 실패하지 않습니다.
 */
export async function renderVideo(
  request: RenderRequest,
  options: { ffmpegPath?: string; ffmpeg?: FfmpegInfo | null } = {},
): Promise<RenderResult> {
  const ffmpeg = options.ffmpeg !== undefined ? options.ffmpeg : await detectFfmpeg(options.ffmpegPath);

  if (!ffmpeg) {
    const plan = buildFfmpegPlan(request);
    const scriptPath = path.join(request.workDir, "render.sh");
    await writeFile(
      scriptPath,
      `#!/bin/sh\n# ffmpeg가 설치된 환경에서 실행하세요: FFMPEG_PATH=/usr/bin/ffmpeg sh render.sh\nffmpeg ${plan.args
        .map((arg) => (/[\s'"]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg))
        .join(" ")}\n`,
      "utf8",
    );

    return {
      status: "assets_only",
      renderer: "none",
      outputPath: null,
      bytes: 0,
      durationSeconds: plan.totalSeconds,
      ffmpegPath: null,
      warnings: [
        "ffmpeg를 찾지 못해 MP4를 만들지 못했습니다. 이미지·음성·자막과 render.sh를 남겼습니다.",
        "Vercel 서버리스에서는 ffmpeg를 실행할 수 없습니다. apps/video-worker를 Railway/Fly.io/Cloud Run에 배포하세요(docs/DEPLOY.md).",
      ],
    };
  }

  try {
    return await renderWithFfmpeg(request, ffmpeg);
  } catch (error) {
    return {
      status: "assets_only",
      renderer: "none",
      outputPath: null,
      bytes: 0,
      durationSeconds: 0,
      ffmpegPath: ffmpeg.path,
      warnings: [
        `ffmpeg 렌더 실패: ${error instanceof Error ? error.message : String(error)}`,
        "자산과 render-command.txt를 남겼으니 명령을 직접 실행해 확인할 수 있습니다.",
      ],
    };
  }
}

export async function ffmpegAvailable(pathHint?: string): Promise<boolean> {
  return (await detectFfmpeg(pathHint)) !== null;
}

/** 진단용: 어떤 실행 파일을 쓸지, 자막 폰트 파일이 있는지 */
export async function doctor(pathHint?: string): Promise<{
  ffmpeg: FfmpegInfo | null;
  ffmpegPathEnv: string | null;
  subtitleFont: string;
  fontFileExists: boolean | null;
  imageProvider: string;
  ttsProvider: string;
  sttProvider: string;
}> {
  const ffmpeg = await detectFfmpeg(pathHint);
  const fontPath = process.env.VIDEO_FONT_PATH?.trim() || "";
  let fontFileExists: boolean | null = null;
  if (fontPath) {
    fontFileExists = await access(fontPath).then(
      () => true,
      () => false,
    );
  }

  const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  const demo = process.env.VIDEO_DEMO === "1";
  const offline = process.env.VIDEO_OFFLINE === "1";
  const demoImage = (process.env.VIDEO_DEMO_IMAGE?.trim() || "pollinations").toLowerCase();
  const demoVoice = (process.env.VIDEO_DEMO_VOICE?.trim() || "google").toLowerCase();

  const imageProvider = hasKey && !demo
    ? `openai:${process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2"}`
    : offline || demoImage === "card"
      ? "demo:demo-gradient"
      : `pollinations:${process.env.POLLINATIONS_MODEL?.trim() || "sana"}`;
  const ttsProvider = hasKey && !demo
    ? `openai:${process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts"}·${process.env.OPENAI_TTS_VOICE?.trim() || "alloy"}·${process.env.OPENAI_TTS_SPEED?.trim() || "1.25"}x`
    : offline || demoVoice === "bed"
      ? "demo:demo-ambient-bed"
      : "google:gtts-free";

  return {
    ffmpeg,
    ffmpegPathEnv: process.env.FFMPEG_PATH?.trim() || null,
    subtitleFont: process.env.VIDEO_SUBTITLE_FONT?.trim() || "Noto Sans CJK KR",
    fontFileExists,
    imageProvider,
    ttsProvider,
    sttProvider: hasKey && !demo ? `openai:${process.env.OPENAI_STT_MODEL?.trim() || "whisper-1"}` : "fallback",
  };
}
