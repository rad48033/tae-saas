import { createAnthropicProvider, DEFAULT_MODEL } from "@tae/ai";

import { DemoTtsProvider } from "./audio/demo";
import { OpenAITtsProvider } from "./audio/openai";
import { DemoImageProvider } from "./images/demo";
import { OpenAIImageProvider } from "./images/openai";
import { AlignedSttProvider } from "./stt/fallback";
import { OpenAISTTProvider } from "./stt/openai";

import type { AiProvider } from "@tae/ai";
import type { ImageProvider, SttProvider, TtsProvider } from "./types";

export interface VideoProviderSet {
  image: ImageProvider;
  tts: TtsProvider;
  stt: SttProvider;
  /** 스토리보드 LLM. 키가 없으면 undefined → 데모 스토리보드 */
  storyboard: AiProvider | null;
  warnings: string[];
  mode: "openai" | "demo" | "mixed";
}

export interface VideoProviderOptions {
  env?: Record<string, string | undefined>;
  /** 강제로 데모 제공자만 쓸지 */
  demo?: boolean;
  voice?: string;
}

/**
 * 환경변수로 실제 제공자와 결정적 데모를 고릅니다.
 *   OPENAI_API_KEY             이미지·TTS·STT
 *   ANTHROPIC_API_KEY          스토리보드(대본) LLM
 *   VIDEO_DEMO=1               키가 있어도 데모만 사용 (렌더 검증용)
 */
export function createVideoProviders(options: VideoProviderOptions = {}): VideoProviderSet {
  const env = options.env ?? process.env;
  const demo = options.demo ?? env.VIDEO_DEMO === "1";
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const warnings: string[] = [];

  const storyboard =
    !demo && anthropicKey
      ? createAnthropicProvider({
          apiKey: anthropicKey,
          model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL,
        })
      : null;

  if (!demo && !anthropicKey) warnings.push("ANTHROPIC_API_KEY가 없어 데모 스토리보드로 생성했습니다.");

  const useOpenAI = Boolean(openaiKey) && !demo;
  if (!useOpenAI) {
    warnings.push("OPENAI_API_KEY가 없어 데모 이미지·음성·자막 정렬을 사용했습니다.");
    return {
      image: new DemoImageProvider(),
      tts: new DemoTtsProvider(),
      stt: new AlignedSttProvider(),
      storyboard,
      warnings,
      mode: "demo",
    };
  }

  const image = new OpenAIImageProvider({
    apiKey: openaiKey!,
    ...(env.OPENAI_IMAGE_MODEL?.trim() ? { model: env.OPENAI_IMAGE_MODEL.trim() } : {}),
    ...(env.OPENAI_IMAGE_QUALITY?.trim() ? { quality: env.OPENAI_IMAGE_QUALITY.trim() } : {}),
    ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
  });

  const tts = new OpenAITtsProvider({
    apiKey: openaiKey!,
    ...(env.OPENAI_TTS_MODEL?.trim() ? { model: env.OPENAI_TTS_MODEL.trim() } : {}),
    ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
    ...(env.OPENAI_TTS_VOICE?.trim() ? {} : {}),
  });

  const stt = new OpenAISTTProvider({
    apiKey: openaiKey!,
    ...(env.OPENAI_STT_MODEL?.trim() ? { model: env.OPENAI_STT_MODEL.trim() } : {}),
    ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
  });

  return {
    image,
    tts,
    stt,
    storyboard,
    warnings,
    mode: storyboard ? "openai" : "mixed",
  };
}

/** 장면·대본에 맞는 기본 보이스 */
export function resolveVoice(voice: string | undefined, env: Record<string, string | undefined> = process.env): string {
  return voice?.trim() || env.OPENAI_TTS_VOICE?.trim() || "alloy";
}
