import type { ContentDraft, ContentFormat, SourceType } from "@tae/ai";
import type { AspectRatio, Storyboard, SubtitleSet } from "@tae/video";

export type Language = "ko" | "en";
export type OutputFormat = ContentFormat | "youtube_video";
/** 텍스트 3종 */
export type TextFormat = ContentFormat;
export const TEXT_FORMATS: readonly TextFormat[] = ["blog", "instagram", "facebook"] as const;

export const FORMAT_META: Record<OutputFormat, { icon: string; label: string; short: string; hint: string }> = {
  youtube_video: {
    icon: "🎬",
    label: "영상",
    short: "영상",
    hint: "스토리보드 + 나레이션 + AI 이미지 + TTS + 자막 + MP4",
  },
  blog: {
    icon: "📝",
    label: "블로그",
    short: "블로그",
    hint: "인플루언서급 장문 · 본문 2,000자+ · FAQ · 태그",
  },
  instagram: {
    icon: "📱",
    label: "인스타 10장",
    short: "인스타",
    hint: "훅 + 카드뉴스 10장 + 캡션 + 해시태그",
  },
  facebook: {
    icon: "📘",
    label: "페이스북 20줄",
    short: "페이스북",
    hint: "20줄 피드 스토리 + 핵심 불릿 + 댓글 질문",
  },
};

export interface VideoPackagePayload {
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
  /** 실제 제품 사진 참조 수·이름 */
  references?: { count: number; labels: string[] };
  subtitles: { srt: string; ass: string; cueCount: number; source: SubtitleSet["source"] };
  render: { available: boolean; mode: "worker" | "inline" | "disabled"; reason: string | null };
}

export interface ConvertSourcePayload {
  sourceType: SourceType;
  title: string;
  author: string;
  url: string | null;
  thumbnailUrl: string | null;
  textChars: number;
  textSource: string;
  imageCount?: number;
  warnings: string[];
}

export interface ConvertResult {
  jobId: string;
  format: OutputFormat;
  formats?: OutputFormat[];
  /** 만들지 못한 형식(나머지는 정상 반환) */
  failedFormats?: TextFormat[];
  source: ConvertSourcePayload;
  draft: ContentDraft | null;
  drafts?: Partial<Record<TextFormat, ContentDraft>>;
  video: VideoPackagePayload | null;
  credits: { remaining: number; charged: number };
  meta: {
    provider: string;
    model: string;
    mode: "anthropic" | "demo" | "openai" | "gemini";
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
    textChars?: number;
    textLanguage?: string;
    textSource?: string;
    warnings?: string[];
  };
}

/** /api/convert 로 보내는 요청 본문. 결과 탭에서 같은 원문으로 다른 형식을 만들 때 재사용합니다. */
export interface ConvertRequestPayload {
  sourceType: SourceType;
  url?: string;
  text?: string;
  transcript?: string;
  title?: string;
  author?: string;
  format?: OutputFormat;
  formats?: TextFormat[];
  aspectRatio?: AspectRatio;
  language: Language;
  focusKeyword?: string;
  audience?: string;
  referenceImages?: string[];
  /** 유튜브 자막을 못 가져올 때 영상 설명으로 계속 만들지(사용자가 고른 경우) */
  allowDescriptionFallback?: boolean;
}

export interface CreditCosts {
  text: number;
  textSet: number;
  videoStoryboard: number;
  videoRender: number;
  videoPreview: number;
  videoTotal: number;
  pdfPagesPerCredit: number;
  trial: number;
}

export interface VideoJobView {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "unavailable";
  stage: string;
  progress: number;
  mode: "worker" | "inline" | "disabled";
  aspectRatio: AspectRatio;
  title: string;
  durationMs: number | null;
  video: { bytes: number; durationSeconds: number; renderer: "ffmpeg" | "none" } | null;
  files: { mp4: string | null; srt: string | null; ass: string | null; storyboard: string | null };
  warnings: string[];
  error: string | null;
}

/** 결과에서 실제로 만들어진 텍스트 형식 목록 */
export function draftFormats(result: ConvertResult | null): TextFormat[] {
  if (!result) return [];
  const fromDrafts = result.drafts ? Object.keys(result.drafts) : [];
  const merged = new Set<string>(fromDrafts);
  if (result.draft) merged.add(result.draft.format);
  return TEXT_FORMATS.filter((format) => merged.has(format));
}

export function draftOf(result: ConvertResult | null, format: TextFormat): ContentDraft | null {
  if (!result) return null;
  const fromMap = result.drafts?.[format];
  if (fromMap) return fromMap;
  return result.draft?.format === format ? result.draft : null;
}
