import { z } from "zod";

import { clampText, completeJson, normalizeWhitespace, truncateForPrompt } from "@tae/ai";
import type { AiProvider, SourceDocument } from "@tae/ai";

import { aspectPreset } from "./aspect";
import { buildDemoStoryboard } from "./demo/storyboard";
import type { AspectRatio, Storyboard, StoryboardDraft, StoryboardOptions, StoryboardResult, VideoLanguage } from "./types";

export const storyboardDraftSchema = z.object({
  title: z.string().min(4).max(120),
  hook: z.string().min(4).max(200),
  description: z.string().max(1200).default(""),
  style: z.string().max(400).default(""),
  scenes: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        narration: z.string().min(10).max(1200),
        visualPrompt: z.string().min(10).max(800),
        onScreenText: z.string().max(60).optional(),
      }),
    )
    .min(4)
    .max(16),
  hashtags: z.array(z.string().max(40)).max(12).default([]),
});

export type StoryboardDraftInput = z.infer<typeof storyboardDraftSchema>;

export const storyboardSceneSchema = z.object({
  index: z.number().int().min(1),
  title: z.string().min(1).max(120),
  narration: z.string().min(1).max(2_000),
  visualPrompt: z.string().min(1).max(2_000),
  onScreenText: z.string().max(120).optional(),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  durationMs: z.number().min(1),
});

/** 워커가 받은 스토리보드를 검증할 때 쓰는 스키마. */
export const storyboardSchema = z.object({
  version: z.literal(1),
  aspectRatio: z.enum(["9:16", "16:9"]),
  width: z.number().int().min(240).max(4096),
  height: z.number().int().min(240).max(4096),
  fps: z.number().int().min(12).max(60),
  language: z.enum(["ko", "en"]),
  voice: z.string().min(1).max(60),
  source: z.object({
    type: z.enum(["youtube", "blog", "instagram"]),
    title: z.string().max(300),
    author: z.string().max(200),
    url: z.string().max(1000).optional(),
  }),
  title: z.string().min(1).max(200),
  hook: z.string().max(400),
  description: z.string().max(2_000),
  style: z.string().max(600),
  scenes: z.array(storyboardSceneSchema).min(1).max(20),
  hashtags: z.array(z.string().max(60)).max(12),
  totalDurationMs: z.number().min(1_000),
  createdAt: z.string(),
});

const MAX_SOURCE_CHARS = 20_000;

const STORYBOARD_SYSTEM = [
  "당신은 유튜브 쇼츠(9:16)와 가로형 영상(16:9)을 만드는 영상 기획자 겸 대본 작가입니다.",
  "주어진 원문만 근거로, 장면별 스토리보드와 나레이션 대본을 만듭니다.",
  "",
  "절대 규칙:",
  "1. 원문에 없는 사실·수치·인물·제품을 만들지 않습니다.",
  "2. 각 장면은 '무엇을 말하는지'가 하나로 분명해야 합니다. 한 장면에 주장 두 개를 넣지 않습니다.",
  "3. 나레이션은 말하듯 씁니다. 문어체 요약이 아니라, 소리 내어 읽었을 때 자연스러운 문장이어야 합니다.",
  "4. visualPrompt는 반드시 영어로, 이미지 생성 모델이 이해하는 구체적 장면 묘사로 씁니다. 화면 안에 글자를 넣으라고 요청하지 않습니다(자막은 따로 태웁니다).",
  "5. 결과는 설명 없이 JSON 객체 하나만 출력합니다.",
  "",
  "장면 구성:",
  "- 1번 장면은 훅입니다. 시청자가 스크롤을 멈출 이유를 첫 문장에 넣습니다.",
  "- 마지막 장면은 정리 + 다음 행동(구독·저장·확인할 것)으로 끝냅니다.",
  "- 중간 장면은 원문의 순서를 따르되, 각 장면이 독립적으로 이해되게 씁니다.",
  "- onScreenText는 화면에 크게 띄울 12자 이내의 짧은 문구입니다(선택).",
  "",
  "출력 JSON:",
  JSON.stringify(
    {
      title: "string (영상 제목, 60자 이내)",
      hook: "string (첫 문장 훅)",
      description: "string (유튜브 설명란, 2~4문장)",
      style: "string (영상 전체의 시각 스타일, 영어 한 문장)",
      scenes: [
        {
          title: "string (장면 제목, 20자 이내)",
          narration: "string (말하듯 쓴 나레이션)",
          visualPrompt: "string (영어, 장면 이미지 묘사)",
          onScreenText: "string (선택, 12자 이내)",
        },
      ],
      hashtags: ["string (3~8개)"],
    },
    null,
    2,
  ),
].join("\n");

export function buildStoryboardPrompt(
  source: SourceDocument,
  options: StoryboardOptions,
): { system: string; prompt: string; maxTokens: number } {
  const preset = aspectPreset(options.aspectRatio);
  const language: VideoLanguage = options.language ?? (source.language === "en" ? "en" : "ko");
  const { text, truncated } = truncateForPrompt(source.text, MAX_SOURCE_CHARS);
  const targetSeconds = options.targetDurationSeconds ?? preset.durationSeconds.target;
  const sceneCount = options.maxScenes ?? preset.scenes.preferred;

  const prompt = [
    `다음 원문을 ${options.aspectRatio === "9:16" ? "세로형 쇼츠(9:16)" : "가로형(16:9)"} 유튜브 영상의 스토리보드로 만드세요.`,
    "",
    "[원문]",
    `- 입력 유형: ${source.sourceType}`,
    `- 제목: ${source.title}`,
    `- 작성자/채널: ${source.author}`,
    source.url ? `- URL: ${source.url}` : "",
    "",
    "[요구사항]",
    `- 언어: ${language === "ko" ? "한국어" : "English"} (나레이션·제목·해시태그 모두)`,
    `- 화면 비율: ${options.aspectRatio} (${preset.width}x${preset.height})`,
    `- 장면 수: ${preset.scenes.min}~${preset.scenes.max}개 (권장 ${sceneCount}개)`,
    `- 총 길이: ${preset.durationSeconds.min}~${preset.durationSeconds.max}초 (목표 ${Math.round(targetSeconds)}초)`,
    `- 장면 하나의 나레이션은 ${Math.round((preset.durationSeconds.target / sceneCount) * preset.speechCharsPerSecond[language])}자 안팎으로 씁니다.`,
    "",
    `[원문${truncated ? " (일부 생략됨)" : ""}]`,
    '"""',
    text,
    '"""',
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { system: STORYBOARD_SYSTEM, prompt, maxTokens: 4000 };
}

/**
 * 초안을 실제 타이밍이 붙은 스토리보드로 확정합니다.
 * 길이는 나레이션 글자 수에서 추정하고, 목표 길이 범위로 정규화합니다.
 */
export function finalizeStoryboard(
  draft: StoryboardDraftInput,
  options: {
    aspectRatio: AspectRatio;
    source: SourceDocument;
    language?: VideoLanguage;
    voice?: string;
    targetDurationSeconds?: number;
  },
): Storyboard {
  const preset = aspectPreset(options.aspectRatio);
  const language: VideoLanguage = options.language ?? (options.source.language === "en" ? "en" : "ko");
  const scenes = ensureSceneCount(draft.scenes, preset.scenes.min, preset.scenes.max);
  const durations = fitDurations(
    scenes.map((scene) => scene.narration.length),
    preset.speechCharsPerSecond[language],
    preset,
    options.targetDurationSeconds,
  );

  let cursor = 0;
  const timed = scenes.map((scene, index) => {
    const durationMs = durations[index] ?? 3_000;
    const startMs = cursor;
    cursor += durationMs;
    return {
      index: index + 1,
      title: clampText(scene.title, 60),
      narration: normalizeWhitespace(scene.narration),
      visualPrompt: normalizeWhitespace(scene.visualPrompt),
      ...(scene.onScreenText ? { onScreenText: clampText(scene.onScreenText, 60) } : {}),
      startMs,
      endMs: startMs + durationMs,
      durationMs,
    };
  });

  const style =
    draft.style?.trim() ||
    "cinematic editorial photography, warm natural light, shallow depth of field, muted color palette, subtle film grain";

  return {
    version: 1,
    aspectRatio: options.aspectRatio,
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    language,
    voice: options.voice ?? defaultVoice(language),
    source: {
      type: options.source.sourceType,
      title: options.source.title,
      author: options.source.author,
      ...(options.source.url ? { url: options.source.url } : {}),
    },
    title: clampText(draft.title, 120),
    hook: clampText(draft.hook, 200),
    description: clampText(draft.description ?? "", 1200),
    style,
    scenes: timed.map((scene) => ({
      ...scene,
      visualPrompt: withStylePrompt(scene.visualPrompt, style, preset.frameHint, options.source.title),
    })),
    hashtags: draft.hashtags.map((tag) => `#${tag.replace(/^#+/, "").trim()}`).filter((tag) => tag.length > 1).slice(0, 10),
    totalDurationMs: cursor,
    createdAt: new Date().toISOString(),
  };
}

export function withStylePrompt(visualPrompt: string, style: string, frameHint: string, topic: string): string {
  const prompt = visualPrompt.trim().replace(/\.$/, "");
  return [
    prompt,
    `Editorial image for a video about "${topic.replace(/"/g, "'")}"`,
    style.replace(/\.$/, ""),
    frameHint.replace(/\.$/, ""),
  ]
    .filter(Boolean)
    .join(". ")
    .concat(". No text, no lettering, no watermark, no logos.");
}

/** 장면이 너무 적으면 가장 긴 나레이션을 문장 경계에서 나눠 최소 장면 수를 채웁니다. */
export function ensureSceneCount<T extends { narration: string }>(scenes: T[], min: number, max: number): T[] {
  const list = [...scenes];
  while (list.length < min) {
    let longestIndex = 0;
    for (let index = 1; index < list.length; index += 1) {
      if ((list[index]?.narration.length ?? 0) > (list[longestIndex]?.narration.length ?? 0)) longestIndex = index;
    }
    const target = list[longestIndex];
    if (!target) break;

    const parts = splitForSplit(target.narration);
    if (parts.length < 2) break;

    const [first, ...rest] = parts;
    if (!first) break;
    list.splice(longestIndex, 1, { ...target, narration: first }, { ...target, narration: rest.join(" ") });
  }
  return list.slice(0, max);
}

function splitForSplit(narration: string): string[] {
  const sentences = narration
    .split(/(?<=[.!?。？！])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length >= 2) {
    const half = Math.ceil(sentences.length / 2);
    return [sentences.slice(0, half).join(" "), sentences.slice(half).join(" ")];
  }

  const words = narration.split(" ");
  if (words.length < 6) return [];
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}

/**
 * 나레이션 길이 → 장면 길이 → 총 길이 정규화.
 * 합이 목표 범위를 벗어나면 여백(무음)으로 늘리거나 비율로 줄입니다.
 */
export function fitDurations(
  narrationLengths: number[],
  charsPerSecond: number,
  preset: import("./types").AspectPreset,
  targetDurationSeconds?: number,
): number[] {
  const raw = narrationLengths.map((length) =>
    clampNumber(length / Math.max(1, charsPerSecond) + 0.7, 3, preset.maxSceneSeconds),
  );
  const target = clampNumber(
    targetDurationSeconds ?? preset.durationSeconds.target,
    preset.durationSeconds.min,
    preset.durationSeconds.max,
  );
  const total = raw.reduce((sum, duration) => sum + duration, 0) || 1;
  const scale = target / total;

  let durations = raw.map((duration) => clampNumber(duration * scale, 2.8, preset.maxSceneSeconds));
  durations = balanceToRange(durations, preset.durationSeconds.min, preset.durationSeconds.max, preset.maxSceneSeconds);

  // 정수 ms로 맞추고, 반올림 오차를 마지막 장면에서 흡수합니다.
  const ms = durations.map((duration) => Math.round(duration * 1000));
  const sum = ms.reduce((totalMs, value) => totalMs + value, 0);
  const targetMs = Math.round(clampNumber(sum / 1000, preset.durationSeconds.min, preset.durationSeconds.max) * 1000);
  const diff = targetMs - sum;
  if (ms.length > 0) ms[ms.length - 1] = Math.max(2500, (ms[ms.length - 1] ?? 0) + diff);
  return ms;
}

function balanceToRange(durations: number[], min: number, max: number, maxScene: number): number[] {
  const result = [...durations];
  let total = result.reduce((sum, duration) => sum + duration, 0);

  if (total < min) {
    let remaining = min - total;
    for (let index = 0; index < result.length && remaining > 0; index += 1) {
      const room = maxScene - (result[index] ?? 0);
      const add = Math.min(room, remaining);
      result[index] = (result[index] ?? 0) + add;
      remaining -= add;
    }
    return result;
  }

  if (total > max) {
    let excess = total - max;
    while (excess > 0.05) {
      const reducible = result.filter((duration) => duration > 3);
      if (reducible.length === 0) break;
      const share = Math.min(excess / reducible.length, 0.5);
      for (let index = 0; index < result.length && excess > 0.05; index += 1) {
        const duration = result[index] ?? 0;
        if (duration <= 3) continue;
        const cut = Math.min(share, duration - 3, excess);
        result[index] = duration - cut;
        excess -= cut;
      }
    }
    total = result.reduce((sum, duration) => sum + duration, 0);
  }

  return result;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function defaultVoice(language: VideoLanguage): string {
  return language === "ko" ? "alloy" : "alloy";
}

/**
 * 스토리보드 생성. API 키가 있으면 Claude, 없으면 결정적 데모 생성기.
 * 키가 있는데 호출이 실패하면 조용히 데모로 넘어가지 않고 오류를 던집니다.
 */
export async function generateStoryboard(
  source: SourceDocument,
  options: StoryboardOptions,
): Promise<StoryboardResult> {
  if (!options.provider) {
    const storyboard = buildDemoStoryboard(source, options);
    return {
      storyboard,
      provider: "demo",
      model: "demo-storyboard",
      usage: { inputTokens: 0, outputTokens: 0 },
      warnings: [],
    };
  }

  const provider: AiProvider = options.provider;
  const request = buildStoryboardPrompt(source, options);
  const result = await completeJson(provider, request, storyboardDraftSchema);

  const language: VideoLanguage = options.language ?? (source.language === "en" ? "en" : "ko");
  const warnings: string[] = [];
  if (result.value.scenes.length < aspectPreset(options.aspectRatio).scenes.min) {
    warnings.push("모델이 최소 장면 수보다 적게 만들었습니다. 나레이션을 나눠 장면 수를 맞췄습니다.");
  }

  return {
    storyboard: finalizeStoryboard(result.value, {
      aspectRatio: options.aspectRatio,
      source,
      language,
      ...(options.voice ? { voice: options.voice } : {}),
      ...(options.targetDurationSeconds ? { targetDurationSeconds: options.targetDurationSeconds } : {}),
    }),
    provider: "anthropic",
    model: result.model,
    usage: result.usage,
    warnings,
  };
}
