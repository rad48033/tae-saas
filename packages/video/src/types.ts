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
    /** 그림자 오프셋(0이면 없음). 모바일에서 밝은 배경 위 글자를 띄웁니다. */
    shadow: number;
    /** 반투명 검정 박스(BorderStyle=3). 밝은 제품 사진 위에서도 또렷하게 읽힙니다. */
    box: boolean;
    maxCharsPerCue: number;
    maxCharsPerLine: number;
    maxLines: number;
    /** 한 자막 컷이 화면에 머무는 최대 시간(ms). 릴스는 짧게 끊어야 호흡이 맞습니다. */
    maxCueMs: number;
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
    // 1.25배속 TTS + 6~7초 컷: 릴스는 장면이 길면 정지화면처럼 느껴집니다.
    scenes: { min: 6, max: 10, preferred: 8 },
    durationSeconds: { min: 30, max: 60, target: 45 },
    maxSceneSeconds: 7,
    // gpt-4o-mini-tts 1.25배속으로 실제 측정한 한국어 말 속도는 약 7자/초입니다.
    // 이 값으로 대본 길이를 안내해야 8장면·45초 목표에 맞는 분량이 나옵니다.
    speechCharsPerSecond: { ko: 7.0, en: 20 },
    subtitle: {
      fontSize: 76,
      marginV: 300,
      outline: 5,
      shadow: 1,
      box: false,
      maxCharsPerCue: 18,
      maxCharsPerLine: 11,
      maxLines: 2,
      maxCueMs: 2_500,
    },
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
    subtitle: {
      fontSize: 60,
      marginV: 90,
      outline: 3,
      shadow: 1,
      box: false,
      maxCharsPerCue: 34,
      maxCharsPerLine: 18,
      maxLines: 2,
      maxCueMs: 4_200,
    },
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

// ── 참조 이미지 (실제 제품 사진) ────────────────────────────────────────────

/**
 * 참조 이미지의 역할.
 * product: 실제 제품 패키지 사진 — 장면에 그대로 유지해야 하는 외관
 * scene:   실제 공간·인물·분위기 사진 — 장면의 배경 참고
 * style:   색감·조명 참고
 */
export type ReferenceImageRole = "product" | "scene" | "style";

/** 호출자가 넘기는 참조 이미지 입력. URL · 로컬 경로 · data URL(base64) 중 하나. */
export interface ReferenceImage {
  url?: string;
  path?: string;
  /** data:image/...;base64,... 또는 순수 base64 문자열 */
  data?: string;
  mimeType?: string;
  /** 프롬프트·manifest에 남길 이름 (예: "제품 박스 정면") */
  label?: string;
  role?: ReferenceImageRole;
}

/** 파일 경로·URL을 실제 바이트로 읽어 둔 참조 이미지. */
export interface ResolvedReferenceImage {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  label: string;
  role: ReferenceImageRole;
  /** 출처 표기 (URL · 로컬 경로 · inline:base64) */
  origin: string;
  /** 내용 해시 앞 10자 (manifest에서 같은 사진인지 확인용) */
  sha256: string;
}

/** 스토리보드·워커 JSON에 실어 보내는 참조 이미지 표기(바이트 제외). */
export interface StoryboardReference {
  url?: string;
  label: string;
  role: ReferenceImageRole;
  mimeType?: string;
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
  /**
   * 실제 제품·공간 사진. 이미지 생성 단계가 이 사진들을 참조 이미지로 함께 넘겨
   * 제품 패키지 외관(로고·색·인쇄 문구)을 장면마다 그대로 유지합니다.
   * 바이트는 담지 않고 URL만 담습니다(워커가 직접 내려받습니다).
   */
  references?: StoryboardReference[];
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
  /** 실제 제품·공간 사진. 대본이 제품 외관을 상상하지 않고 참조 사진을 가리키게 합니다. */
  referenceImages?: ReferenceImage[];
}

export interface StoryboardResult {
  storyboard: Storyboard;
  provider: import("@tae/ai").AiProviderId;
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
  provider: "openai" | "gemini" | "fallback";
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
  /**
   * 실제 제품·공간 사진. 있으면 텍스트만으로 그리는 대신 Images 편집(참조 이미지) 경로를 씁니다.
   * product 역할 사진은 프롬프트에서 "첨부한 그 패키지"로 고정됩니다.
   */
  referenceImages?: ResolvedReferenceImage[];
}

export interface GeneratedImage {
  sceneIndex: number;
  path: string;
  width: number;
  height: number;
  provider: ImageProvider["id"];
  /** 실제 사용한 모델명(제공자별 표기) */
  model?: string;
  /** 실제 사용한 프롬프트 */
  prompt: string;
  /** generate: 텍스트만으로 생성 · edit: 참조 이미지와 함께 생성 */
  mode?: "generate" | "edit";
  referenceCount?: number;
}

export interface ImageProvider {
  readonly id: "openai" | "pollinations" | "demo";
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
  provider: TtsProvider["id"];
  /** 실제 사용한 모델명(제공자별 표기) */
  model?: string;
  sampleRate?: number;
}

export interface TtsProvider {
  readonly id: "openai" | "gemini" | "google" | "demo";
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
  provider: "openai" | "gemini" | "fallback";
  /** 전사된 실제 발화문(있으면). 나레이션과 비교해 오디오 품질을 확인합니다. */
  text?: string;
  warnings: string[];
}

export interface SttProvider {
  readonly id: "openai" | "gemini" | "fallback";
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
  /**
   * 음성이 장면 길이보다 길 때의 배속(1 = 원속).
   * 장면 최대 길이를 넘는 나레이션이 잘리지 않도록 ffmpeg atempo로 압축합니다.
   */
  tempo?: number;
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
  /** 실제 제품·공간 사진. 스토리보드(references)와 합쳐 이미지 단계에 넘깁니다. */
  referenceImages?: ReferenceImage[];
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
  /** 실제로 이미지 단계에 넘긴 참조 이미지 요약 */
  references?: { count: number; labels: string[]; roles: ReferenceImageRole[] };
  providers: { storyboard: string; image: string; tts: string; stt: string };
  warnings: string[];
  durationMs: number;
  videoBytes: number;
  videoDurationSeconds: number;
}
