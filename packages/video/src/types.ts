/**
 * 영상 패키지의 공용 타입.
 *
 * 파이프라인은 다섯 단계입니다.
 *   1) storyboard  — 원문을 장면으로 나누고 나레이션·영어 비주얼 프롬프트를 만든다
 *   2) images      — 장면별 이미지 생성 (OpenAI Images 또는 결정적 데모 PNG)
 *   3) tts         — 장면별 나레이션 음성 (OpenAI TTS 또는 결정적 데모 WAV)
 *   4) stt         — 생성된 음성에서 타임스탬프를 뽑아 자막(.srt/.ass)을 만든다
 *   5) render      — ffmpeg로 Ken Burns 줌/팬 + 음성 + 자막을 합쳐 MP4를 만든다
 *
 * 모든 단계는 "제공자 인터페이스 + 실제 구현 + 결정적 폴백" 구조입니다.
 */

import type { SourceDocument, SourceType } from "@tae/ai";

export type AspectRatio = "9:16" | "16:9";

export const ASPECT_RATIOS: readonly AspectRatio[] = ["9:16", "16:9"] as const;

export function isAspectRatio(value: string): value is AspectRatio {
  return (ASPECT_RATIOS as readonly string[]).includes(value);
}

export type VideoLanguage = "ko" | "en";

export interface AspectPreset {
  id: AspectRatio;
  /** UI 라벨 */
  label: string;
  width: number;
  height: number;
  fps: number;
  /** 장면 수 권장 범위 */
  scenes: { min: number; max: number; preferred: number };
  /** 총 길이 목표 (초) */
  durationSeconds: { min: number; max: number; target: number };
  /** 장면 하나의 최대 길이 */
  maxSceneSeconds: number;
  /** 언어별 1초당 말하는 글자 수 (나레이션 길이 → 재생 시간 추정) */
  speechCharsPerSecond: Record<VideoLanguage, number>;
  subtitle: {
    fontSize: number;
    marginV: number;
    outline: number;
    maxCharsPerCue: number;
    maxCharsPerLine: number;
    maxLines: number;
  };
  /** 이미지 프롬프트에 붙이는 구도 힌트 */
  frameHint: string;
}

export const ASPECT_PRESETS: Record<AspectRatio, AspectPreset> = {
  "9:16": {
    id: "9:16",
    label: "9:16 쇼츠",
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: { min: 5, max: 8, preferred: 6 },
    durationSeconds: { min: 45, max: 60, target: 52 },
    maxSceneSeconds: 15,
    speechCharsPerSecond: { ko: 4.8, en: 14 },
    subtitle: { fontSize: 64, marginV: 210, outline: 3, maxCharsPerCue: 22, maxCharsPerLine: 12, maxLines: 2 },
    frameHint: "Vertical 9:16 composition, subject centered, generous headroom and bottom space for captions.",
  },
  "16:9": {
    id: "16:9",
    label: "16:9 가로형",
    width: 1920,
    height: 1080,
    fps: 30,
    scenes: { min: 8, max: 12, preferred: 10 },
    durationSeconds: { min: 90, max: 180, target: 135 },
    maxSceneSeconds: 22,
    speechCharsPerSecond: { ko: 5.1, en: 15 },
    subtitle: { fontSize: 58, marginV: 84, outline: 3, maxCharsPerCue: 34, maxCharsPerLine: 18, maxLines: 2 },
    frameHint: "Wide 16:9 cinematic composition, subject on one third, room for lower-third captions.",
  },
};

export function aspectPreset(ratio: AspectRatio): AspectPreset {
  return ASPECT_PRESETS[ratio];
}

// ── 스토리보드 ────────────────────────────────────────────────────────────

export interface StoryboardScene {
  /** 1부터 */
  index: number;
  /** 화면 상단 제목 (짧은 문장) */
  title: string;
  /** 내레이션 대본 */
  narration: string;
  /** 이미지 생성용 영어 프롬프트 (장면 묘사) */
  visualPrompt: string;
  /** 화면에 띄울 짧은 문구 (선택) */
  onScreenText?: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface StoryboardSourceRef {
  type: SourceType;
  title: string;
  author: string;
  url?: string;
}

export interface Storyboard {
  version: 1;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: number;
  language: VideoLanguage;
  voice: string;
  source: StoryboardSourceRef;
  title: string;
  hook: string;
  description: string;
  style: string;
  scenes: StoryboardScene[];
  hashtags: string[];
  totalDurationMs: number;
  createdAt: string;
}

/** LLM이 만들어야 하는 최소 스토리보드 (타이밍은 서버가 계산) */
export interface StoryboardDraft {
  title: string;
  hook: string;
  description: string;
  style: string;
  scenes: {
    title: string;
    narration: string;
    visualPrompt: string;
    onScreenText?: string;
  }[];
  hashtags: string[];
}

export interface StoryboardOptions {
  aspectRatio: AspectRatio;
  language?: VideoLanguage;
  voice?: string;
  /** 없으면 데모 스토리보드 생성기를 씁니다. */
  provider?: import("@tae/ai").AiProvider;
  targetDurationSeconds?: number;
  maxScenes?: number;
}

export interface StoryboardResult {
  storyboard: Storyboard;
  provider: "anthropic" | "demo";
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  warnings: string[];
}

// ── 자막 ──────────────────────────────────────────────────────────────────

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SubtitleSet {
  cues: SubtitleCue[];
  srt: string;
  ass: string;
  /** STT를 썼는지, 결정적 정렬인지 */
  source: "stt" | "aligned";
  provider: "openai" | "fallback";
}

// ── 이미지 ────────────────────────────────────────────────────────────────

export interface ImageRequest {
  scene: StoryboardScene;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  /** 장면 전체 스타일 문장 */
  style: string;
  /** 최종 저장 경로 */
  outPath: string;
}

export interface GeneratedImage {
  sceneIndex: number;
  path: string;
  width: number;
  height: number;
  provider: "openai" | "demo";
  /** 실제 사용한 프롬프트 */
  prompt: string;
}

export interface ImageProvider {
  readonly id: "openai" | "demo";
  readonly model: string;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}

// ── 음성 ──────────────────────────────────────────────────────────────────

export interface TtsRequest {
  text: string;
  language: VideoLanguage;
  voice: string;
  /** 예상 재생 시간 (데모 생성기가 길이를 맞출 때 사용) */
  targetDurationMs: number;
  outPath: string;
  sceneIndex: number;
}

export interface GeneratedAudio {
  sceneIndex: number;
  path: string;
  durationMs: number;
  format: "wav" | "mp3";
  provider: "openai" | "demo";
  sampleRate?: number;
}

export interface TtsProvider {
  readonly id: "openai" | "demo";
  readonly model: string;
  synthesize(request: TtsRequest): Promise<GeneratedAudio>;
}

// ── STT ───────────────────────────────────────────────────────────────────

export interface SttRequest {
  audioPath: string;
  narration: string;
  language: VideoLanguage;
  /** 장면 시작 시각 (자막 타임스탬프에 더해집니다) */
  startMs: number;
  /** 오디오 길이 (타임스탬프가 없을 때 비율 배분에 사용) */
  durationMs: number;
  aspectRatio: AspectRatio;
}

export interface SttResult {
  cues: SubtitleCue[];
  provider: "openai" | "fallback";
  warnings: string[];
}

export interface SttProvider {
  readonly id: "openai" | "fallback";
  readonly model: string;
  transcribe(request: SttRequest): Promise<SttResult>;
}

// ── 렌더 ──────────────────────────────────────────────────────────────────

export interface RenderScene {
  scene: StoryboardScene;
  imagePath: string;
  audioPath: string;
  /** 음성 실측 길이. 장면 길이보다 짧으면 무음으로 채웁니다. */
  audioDurationMs: number;
}

export interface RenderRequest {
  storyboard: Storyboard;
  scenes: RenderScene[];
  subtitlesPath: string;
  outPath: string;
  /** 작업 디렉터리 (ffmpeg 상대 경로용) */
  workDir: string;
  quality: "preview" | "final";
  onProgress?: (progress: number, stage: string) => void;
}

export interface RenderResult {
  status: "succeeded" | "assets_only";
  renderer: "ffmpeg" | "none";
  outputPath: string | null;
  bytes: number;
  durationSeconds: number;
  ffmpegPath: string | null;
  warnings: string[];
}

export interface VideoPipelineOptions {
  source: SourceDocument;
  aspectRatio: AspectRatio;
  outputDir: string;
  language?: VideoLanguage;
  voice?: string;
  quality?: "preview" | "final";
  /** 이미 만든 스토리보드가 있으면 재사용 (워커가 받은 경우) */
  storyboard?: Storyboard;
  storyboardProvider?: import("@tae/ai").AiProvider;
  imageProvider?: ImageProvider;
  ttsProvider?: TtsProvider;
  sttProvider?: SttProvider;
  /** 이미지·음성 생성 동시 수 */
  concurrency?: number;
  onProgress?: (progress: number, stage: string) => void;
  /** 중간 산출물을 남길지 (기본 true) */
  keepWorkFiles?: boolean;
}

export interface VideoPipelineResult {
  storyboard: Storyboard;
  status: "succeeded" | "assets_only" | "failed";
  renderer: "ffmpeg" | "none";
  files: {
    video: string | null;
    srt: string;
    ass: string;
    storyboard: string;
    images: string[];
    audio: string[];
  };
  subtitles: SubtitleSet;
  images: GeneratedImage[];
  audio: GeneratedAudio[];
  providers: { storyboard: string; image: string; tts: string; stt: string };
  warnings: string[];
  durationMs: number;
  videoBytes: number;
  videoDurationSeconds: number;
}
