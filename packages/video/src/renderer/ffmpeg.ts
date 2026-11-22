import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RenderRequest, RenderResult } from "../types";

export interface FfmpegInfo {
  path: string;
  version: string;
}

export interface FfmpegPlan {
  args: string[];
  filter: string;
  totalSeconds: number;
  width: number;
  height: number;
}

const DEFAULT_TIMEOUT_MS = 900_000;

/**
 * ffmpeg 실행 파일을 찾습니다.
 *   1) FFMPEG_PATH 환경변수
 *   2) PATH의 ffmpeg (워커 Docker 이미지는 ffmpeg를 포함합니다)
 * 없으면 null을 돌려주고, 파이프라인은 자산만 남기는 모드로 전환합니다.
 */
export async function detectFfmpeg(explicit?: string): Promise<FfmpegInfo | null> {
  const candidates: string[] = [];
  const configured = explicit ?? process.env.FFMPEG_PATH?.trim();
  if (configured) candidates.push(configured);
  candidates.push("ffmpeg");

  for (const candidate of candidates) {
    const version = await probeFfmpeg(candidate);
    if (version) return { path: candidate, version };
  }
  return null;
}

function probeFfmpeg(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, ["-hide_banner", "-version"], { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const firstLine = String(stdout).split("\n")[0]?.trim() ?? "";
      resolve(firstLine || "ffmpeg");
    });
  });
}

/**
 * 장면별 이미지에 Ken Burns(줌/팬)를 주고, 장면 음성을 붙인 뒤,
 * 자막(.ass)을 태워 하나의 MP4로 합치는 ffmpeg 명령을 만듭니다.
 * 순수 함수라 테스트에서 명령을 검증할 수 있습니다.
 */
export function buildFfmpegPlan(request: RenderRequest): FfmpegPlan {
  const { storyboard, scenes, quality, workDir, subtitlesPath, outPath } = request;
  const scaleDown = quality === "preview" ? 2 : 1;
  const width = Math.round(storyboard.width / scaleDown);
  const height = Math.round(storyboard.height / scaleDown);
  const fps = storyboard.fps;
  const supersample = 2;

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];

  for (const scene of scenes) args.push("-i", path.relative(workDir, scene.imagePath));
  for (const scene of scenes) args.push("-i", path.relative(workDir, scene.audioPath));

  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  let totalSeconds = 0;

  scenes.forEach((renderScene, index) => {
    const durationSeconds = Math.max(0.5, renderScene.scene.durationMs / 1000);
    totalSeconds += durationSeconds;
    const frames = Math.max(2, Math.round(durationSeconds * fps));
    const zoomIn = index % 2 === 0;
    const zoomExpression = zoomIn
      ? `1+0.10*on/${frames}`
      : `1.10-0.10*on/${frames}`;
    const panVariant = index % 3;
    const xExpression =
      panVariant === 0
        ? "iw/2-(iw/zoom/2)"
        : panVariant === 1
          ? `(iw-iw/zoom)*(on/${frames})`
          : `(iw-iw/zoom)*(1-on/${frames})`;
    const yExpression = "ih/2-(ih/zoom/2)";
    // 음성이 장면보다 길면 잘라내지 않고 배속으로 맞춥니다(atempo는 0.5~2.0).
    const tempo = renderScene.tempo && renderScene.tempo > 1.01 ? Math.min(2, renderScene.tempo) : null;
    const tempoFilter = tempo ? `atempo=${tempo.toFixed(3)},` : "";

    filterParts.push(
      `[${index}:v]scale=${width * supersample}:${height * supersample}:force_original_aspect_ratio=increase,` +
        `crop=${width * supersample}:${height * supersample},setsar=1,` +
        `zoompan=z='${zoomExpression}':x='${xExpression}':y='${yExpression}':d=${frames}:s=${width}x${height}:fps=${fps},` +
        `trim=duration=${durationSeconds.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[v${index}]`,
    );

    filterParts.push(
      `[${scenes.length + index}:a]${tempoFilter}atrim=0:${durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad=whole_dur=${durationSeconds.toFixed(3)}[a${index}]`,
    );

    concatInputs.push(`[v${index}][a${index}]`);
  });

  filterParts.push(`${concatInputs.join("")}concat=n=${scenes.length}:v=1:a=1[vc][ac]`);
  filterParts.push(`[vc]ass=filename=${path.relative(workDir, subtitlesPath).replace(/\\/g, "/")}[vout]`);

  const filter = filterParts.join(";");

  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    "[ac]",
    "-c:v",
    "libx264",
    "-preset",
    quality === "preview" ? "ultrafast" : "veryfast",
    "-crf",
    quality === "preview" ? "28" : "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-t",
    totalSeconds.toFixed(3),
    path.relative(workDir, outPath),
  );

  return { args, filter, totalSeconds, width, height };
}

export async function renderWithFfmpeg(
  request: RenderRequest,
  ffmpeg: FfmpegInfo,
): Promise<RenderResult> {
  const plan = buildFfmpegPlan(request);
  const warnings: string[] = [];

  await mkdir(path.dirname(request.outPath), { recursive: true });
  await writeFile(
    path.join(request.workDir, "render-command.txt"),
    `${ffmpeg.path} ${plan.args.map(quoteArg).join(" ")}\n`,
    "utf8",
  );

  await runFfmpeg(ffmpeg.path, plan.args, request.workDir, plan.totalSeconds, request.onProgress);

  const { stat } = await import("node:fs/promises");
  const info = await stat(request.outPath).catch(() => null);
  if (!info || info.size === 0) {
    throw new Error("ffmpeg가 실행됐지만 MP4 파일이 비어 있습니다.");
  }

  return {
    status: "succeeded",
    renderer: "ffmpeg",
    outputPath: request.outPath,
    bytes: info.size,
    durationSeconds: plan.totalSeconds,
    ffmpegPath: ffmpeg.path,
    warnings,
  };
}

function runFfmpeg(
  command: string,
  args: string[],
  cwd: string,
  totalSeconds: number,
  onProgress?: (progress: number, stage: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg 렌더 시간 초과 (${DEFAULT_TIMEOUT_MS / 1000}초)`));
    }, DEFAULT_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);

      // ffmpeg는 기본 loglevel error라 진행률이 없습니다. 프레임 기준 추정만 합니다.
      const match = /frame=\s*(\d+)/.exec(stderr);
      if (match && onProgress && totalSeconds > 0) {
        const seconds = Number(match[1]) / 30;
        onProgress(Math.min(0.99, seconds / totalSeconds), "렌더링");
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        onProgress?.(1, "렌더링");
        resolve();
        return;
      }
      reject(new Error(`ffmpeg 종료 코드 ${code}: ${stderr.slice(-1_500) || "출력 없음"}`));
    });
  });
}

function quoteArg(value: string): string {
  return /[\s'"]/.test(value) ? `'${value.replace(/'/g, "'\\''")}'` : value;
}
