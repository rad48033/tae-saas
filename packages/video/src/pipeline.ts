import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { clampText } from "@tae/ai";

import { aspectPreset } from "./aspect";
import { renderVideo } from "./renderer/index";
import { generateStoryboard } from "./storyboard";
import { alignCueTimings, splitNarrationIntoChunks, subtitleSet } from "./subtitles";
import { createVideoProviders, resolveVoice } from "./providers";
import type {
  GeneratedAudio,
  GeneratedImage,
  Storyboard,
  SubtitleCue,
  VideoPipelineOptions,
  VideoPipelineResult,
} from "./types";
import type { AiProvider } from "@tae/ai";

/**
 * 스토리보드 → 이미지 → 음성 → 자막 → MP4.
 *
 * 모든 중간 산출물은 outputDir 아래에 남습니다.
 *   storyboard.json
 *   images/scene-01.png (+ .prompt.txt)
 *   audio/scene-01.wav
 *   subtitles.srt / subtitles.ass
 *   video.mp4 (ffmpeg가 있을 때)
 *   manifest.json
 */
export async function runVideoPipeline(options: VideoPipelineOptions): Promise<VideoPipelineResult> {
  const preset = aspectPreset(options.aspectRatio);
  const language = options.language ?? (options.source.language === "en" ? "en" : "ko");
  const voice = resolveVoice(options.voice);
  const quality = options.quality ?? "final";
  const outputDir = path.resolve(options.outputDir);
  const imagesDir = path.join(outputDir, "images");
  const audioDir = path.join(outputDir, "audio");
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const startedAt = Date.now();
  const warnings: string[] = [];

  const set = createVideoProviders({ voice });
  warnings.push(...set.warnings);

  const imageProvider = options.imageProvider ?? set.image;
  const imageFallback = options.imageProvider ? null : set.imageFallback;
  const ttsProvider = options.ttsProvider ?? set.tts;
  const ttsFallback = options.ttsProvider ? null : set.ttsFallback;
  const sttProvider = options.sttProvider ?? set.stt;
  const storyboardProvider: AiProvider | null = options.storyboardProvider ?? set.storyboard;

  const progress = (value: number, stage: string) => options.onProgress?.(value, stage);

  await mkdir(imagesDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });

  // 1) 스토리보드
  progress(0.04, "스토리보드");
  let storyboard: Storyboard;
  let storyboardModel = "provided";
  let storyboardProviderId = options.storyboard ? "input" : "demo";

  if (options.storyboard) {
    storyboard = options.storyboard;
  } else {
    const generated = await generateStoryboard(options.source, {
      aspectRatio: options.aspectRatio,
      language,
      voice,
      ...(storyboardProvider ? { provider: storyboardProvider } : {}),
    });
    storyboard = generated.storyboard;
    storyboardModel = generated.model;
    storyboardProviderId = generated.provider;
    warnings.push(...generated.warnings);
  }

  await writeFile(path.join(outputDir, "storyboard.json"), `${JSON.stringify(storyboard, null, 2)}\n`, "utf8");
  progress(0.1, "스토리보드 완료");

  // 2) 이미지
  const failedImages = new Set<string>();
  const images = await mapWithConcurrency(storyboard.scenes, concurrency, async (scene) => {
    const outPath = path.join(imagesDir, `scene-${String(scene.index).padStart(2, "0")}.png`);
    const request = {
      scene,
      aspectRatio: options.aspectRatio,
      width: preset.width,
      height: preset.height,
      style: storyboard.style,
      outPath,
    };
    let image: GeneratedImage;
    try {
      image = await imageProvider.generate(request);
    } catch (error) {
      if (!imageFallback) throw error;
      image = await imageFallback.generate(request);
      const message = error instanceof Error ? error.message : String(error);
      if (!failedImages.has(message)) {
        failedImages.add(message);
        warnings.push(`이미지 제공자(${imageProvider.id}) 실패로 카드 이미지를 사용했습니다: ${message}`);
      }
    }
    progress(0.1 + (0.25 * scene.index) / storyboard.scenes.length, `이미지 ${scene.index}/${storyboard.scenes.length}`);
    return image;
  });

  // 3) 음성 (목표 길이 = 장면 길이)
  const failedVoices = new Set<string>();
  const audio = await mapWithConcurrency(storyboard.scenes, concurrency, async (scene) => {
    const outPath = path.join(audioDir, `scene-${String(scene.index).padStart(2, "0")}.wav`);
    const request = {
      text: scene.narration,
      language,
      voice: storyboard.voice,
      targetDurationMs: scene.durationMs,
      outPath,
      sceneIndex: scene.index,
    };
    let generated: GeneratedAudio;
    try {
      generated = await ttsProvider.synthesize(request);
    } catch (error) {
      if (!ttsFallback) throw error;
      generated = await ttsFallback.synthesize(request);
      const message = error instanceof Error ? error.message : String(error);
      if (!failedVoices.has(message)) {
        failedVoices.add(message);
        warnings.push(`음성 제공자(${ttsProvider.id}) 실패로 배경 음을 사용했습니다: ${message}`);
      }
    }
    progress(0.35 + (0.2 * scene.index) / storyboard.scenes.length, `음성 ${scene.index}/${storyboard.scenes.length}`);
    return generated;
  });

  // 4) 음성 실측 길이에 맞춰 타임라인 재계산
  //
  // TTS가 1.25배속이면 음성이 스토리보드 예상보다 짧아집니다. 예전처럼 스토리보드 길이를
  // 유지하면(max) 빨라진 음성 뒤에 긴 무음이 남아 오히려 느리게 느껴졌습니다.
  // 이제는 실측 음성 + 짧은 여운(tail)만 남기고, 너무 짧은 컷만 최소 길이로 받칩니다.
  const SCENE_TAIL_MS = 220;
  const MIN_SCENE_MS = 2_200;
  const MAX_SCENE_MS = preset.maxSceneSeconds * 1000;
  const plannedDurations = storyboard.scenes.map((scene, index) => {
    const measured = audio[index]?.durationMs ?? scene.durationMs;
    const fitted = Math.min(Math.max(measured + SCENE_TAIL_MS, MIN_SCENE_MS), MAX_SCENE_MS);
    return Math.round(fitted);
  });

  // 실음성(특히 무료 TTS)이 목표 시간을 넘으면 자르지 않고 전체를 같은 비율로 줄인 뒤
  // 초과분만큼만 배속(atempo)으로 맞춥니다. 영상 길이 목표와 대본 완주를 모두 지킵니다.
  const maxTotalMs = preset.durationSeconds.max * 1000;
  const plannedTotal = plannedDurations.reduce((sum, value) => sum + value, 0);
  let durations = plannedDurations;
  if (plannedTotal > maxTotalMs) {
    const factor = maxTotalMs / plannedTotal;
    durations = plannedDurations.map((value) => Math.max(2_500, Math.round(value * factor)));
    warnings.push(
      `음성이 목표(${preset.durationSeconds.max}초)보다 길어 배속으로 ${Math.round(maxTotalMs / 1000)}초에 맞췄습니다.`,
    );
  }

  const retimed = retimeStoryboard(storyboard, durations);

  // 장면 최대 길이를 넘는 음성은 자르지 않고 배속으로 맞춥니다.
  const tempos = audio.map((item, index) => {
    const allowed = durations[index] ?? item.durationMs;
    if (item.durationMs <= allowed + 120) return undefined;
    const tempo = Math.round((item.durationMs / Math.max(1, allowed)) * 100) / 100;
    if (tempo > 1.25) {
      warnings.push(
        `장면 ${index + 1} 음성이 장면 길이보다 ${Math.round((item.durationMs - allowed) / 1000)}초 길어 배속(${Math.min(1.6, tempo)}배)으로 맞췄습니다.`,
      );
    }
    return Math.min(1.6, Math.max(1.02, tempo));
  });

  // 5) 자막 (STT 또는 결정적 정렬)
  progress(0.56, "자막 정렬");
  const cues: SubtitleCue[] = [];
  let sttProviderId = sttProvider.id;
  for (const [index, scene] of retimed.scenes.entries()) {
    const audioFile = audio[index];
    try {
      const result = await sttProvider.transcribe({
        audioPath: audioFile?.path ?? "",
        narration: scene.narration,
        language,
        startMs: scene.startMs,
        durationMs: scene.durationMs,
        aspectRatio: options.aspectRatio,
      });
      cues.push(...result.cues);
      warnings.push(...result.warnings);
    } catch (error) {
      const chunks = splitNarrationIntoChunks(scene.narration, preset.subtitle.maxCharsPerCue);
      cues.push(...alignCueTimings(chunks, scene.startMs, scene.durationMs));
      warnings.push(
        `장면 ${scene.index} STT 실패로 결정적 정렬을 사용했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
      sttProviderId = "fallback";
    }
  }

  const fontName = process.env.VIDEO_SUBTITLE_FONT?.trim() || "Noto Sans CJK KR";
  const usedRealStt = sttProviderId === "openai" || sttProviderId === "gemini";
  const subtitles = subtitleSet(cues, preset, {
    source: usedRealStt ? "stt" : "aligned",
    provider: sttProviderId === "openai" ? "openai" : sttProviderId === "gemini" ? "gemini" : "fallback",
    title: retimed.title,
    fontName,
  });

  const srtPath = path.join(outputDir, "subtitles.srt");
  const assPath = path.join(outputDir, "subtitles.ass");
  await writeFile(srtPath, subtitles.srt, "utf8");
  await writeFile(assPath, subtitles.ass, "utf8");
  progress(0.66, "자막 완료");

  // 6) 렌더
  const videoPath = path.join(outputDir, "video.mp4");
  const render = await renderVideo(
    {
      storyboard: retimed,
      scenes: retimed.scenes.map((scene, index) => ({
        scene,
        imagePath: images[index]?.path ?? path.join(imagesDir, `scene-${String(scene.index).padStart(2, "0")}.png`),
        audioPath: audio[index]?.path ?? path.join(audioDir, `scene-${String(scene.index).padStart(2, "0")}.wav`),
        audioDurationMs: audio[index]?.durationMs ?? scene.durationMs,
        ...(tempos[index] ? { tempo: tempos[index] } : {}),
      })),
      subtitlesPath: assPath,
      outPath: videoPath,
      workDir: outputDir,
      quality,
      onProgress: (value, stage) => progress(0.66 + value * 0.32, stage),
    },
    { ffmpegPath: process.env.FFMPEG_PATH },
  );
  warnings.push(...render.warnings);

  progress(0.99, "마무리");

  const result: VideoPipelineResult = {
    storyboard: retimed,
    status: render.status === "succeeded" ? "succeeded" : "assets_only",
    renderer: render.renderer,
    files: {
      video: render.outputPath,
      srt: srtPath,
      ass: assPath,
      storyboard: path.join(outputDir, "storyboard.json"),
      images: images.map((image) => image.path),
      audio: audio.map((item) => item.path),
    },
    subtitles,
    images,
    audio,
    providers: {
      storyboard: `${storyboardProviderId}:${storyboardModel}`,
      image: summarizeProviders(images.map((image) => `${image.provider}:${image.model ?? imageProvider.model}`)),
      tts: summarizeProviders(audio.map((item) => `${item.provider}:${item.model ?? ttsProvider.model}`)),
      stt: `${sttProvider.id}:${sttProvider.model}`,
    },
    warnings,
    durationMs: Date.now() - startedAt,
    videoBytes: render.bytes,
    videoDurationSeconds: Math.round(retimed.totalDurationMs / 100) / 10,
  };

  const manifest = {
    ...result,
    storyboard: undefined,
    subtitles: { ...subtitles, cues: subtitles.cues.length },
    files: {
      ...result.files,
      srt: path.basename(srtPath),
      ass: path.basename(assPath),
      storyboard: path.basename(path.join(outputDir, "storyboard.json")),
      video: result.files.video ? path.basename(result.files.video) : null,
      images: undefined,
      audio: undefined,
    },
    createdAt: new Date().toISOString(),
  };
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  progress(1, "완료");
  return result;
}

/** 측정된 음성 길이로 장면 시작/끝을 다시 계산합니다. */
export function retimeStoryboard(storyboard: Storyboard, durationsMs: number[]): Storyboard {
  let cursor = 0;
  const scenes = storyboard.scenes.map((scene, index) => {
    const duration = Math.max(1_500, Math.round(durationsMs[index] ?? scene.durationMs));
    const startMs = cursor;
    cursor += duration;
    return { ...scene, startMs, endMs: startMs + duration, durationMs: duration };
  });

  return { ...storyboard, scenes, totalDurationMs: cursor };
}

export async function fileSize(filePath: string): Promise<number> {
  return (await stat(filePath).catch(() => ({ size: 0 }))).size;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/** 실제로 쓰인 제공자만 모아 표시합니다(폴백이 섞여도 진실되게). */
export function summarizeProviders(values: string[]): string {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (unique.length === 0) return "none";
  if (unique.length === 1) return unique[0]!;
  return `mixed(${unique.join(", ")})`;
}

export function summarizeResult(result: VideoPipelineResult): string {
  const title = clampText(result.storyboard.title, 60);
  const seconds = Math.round(result.storyboard.totalDurationMs / 1000);
  const size = result.videoBytes > 0 ? `${Math.round(result.videoBytes / 1024)}KB` : "MP4 없음";
  return `${title} · ${result.storyboard.aspectRatio} · ${result.storyboard.scenes.length}장면 · ${seconds}초 · ${size}`;
}
