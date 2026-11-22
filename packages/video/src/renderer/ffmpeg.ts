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
  // 장면 이미지는 이미 최종 해상도(gpt-image-2 1088x1920)로 생성됩니다.
  // 예전처럼 2배(2160x3840)로 키웠다가 되돌리면 없는 정보를 채우며 오히려 뭉개지므로,
  // lanczos로 최종 크기에 바로 맞추고 줌/팬만 얹습니다.
  const preview = quality === "preview";

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
    // 줌 폭을 10%→8%로 줄여 컷 끝에서도 원본 화소가 늘어나 보이지 않게 합니다.
    const zoomExpression = zoomIn
      ? `1+0.08*on/${frames}`
      : `1.08-0.08*on/${frames}`;
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
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,` +
        `crop=${width}:${height},setsar=1,` +
        `zoompan=z='${zoomExpression}':x='${xExpression}':y='${yExpression}':d=${frames}:s=${width}x${height}:fps=${fps},` +
        `trim=duration=${durationSeconds.toFixed(3)},setpts=PTS-STARTPTS,` +
        // 색: PNG(sRGB, full range)를 BT.709 limited로 정확히 변환해 인스타·플레이어에서 색이 뜨지 않게 합니다.
        `scale=out_color_matrix=bt709:out_range=tv:flags=lanczos,format=yuv420p[v${index}]`,
    );

    filterParts.push(
      `[${scenes.length + index}:a]${tempoFilter}atrim=0:${durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad=whole_dur=${durationSeconds.toFixed(3)}[a${index}]`,
    );

    concatInputs.push(`[v${index}][a${index}]`);
  });

  filterParts.push(`${concatInputs.join("")}concat=n=${scenes.length}:v=1:a=1[vc][ac]`);
  // 음량: 장면마다 다른 TTS 음량을 -14 LUFS(플랫폼 표준)로 한 번에 맞춥니다.
  filterParts.push(`[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);
  filterParts.push(`[vc]ass=filename=${path.relative(workDir, subtitlesPath).replace(/\\/g, "/")}[vout]`);

  const filter = filterParts.join(";");

  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    // 미리보기는 빠르게, 최종본은 화질 우선(1080p30 기준 4~6Mbps).
    "-preset",
    preview ? "ultrafast" : "medium",
    "-crf",
    preview ? "28" : "18",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    // 색 태그를 명시해 인스타·유튜브 업로드 후 색이 뜨거나 어두워지지 않게 합니다.
    "-color_range",
    "tv",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    preview ? "128k" : "192k",
    "-ar",
    "48000",
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
