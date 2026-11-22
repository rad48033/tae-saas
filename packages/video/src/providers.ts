import { createAnthropicProvider, DEFAULT_MODEL } from "@tae/ai";

import { DemoTtsProvider } from "./audio/demo";
import { GoogleTtsProvider } from "./audio/google";
import { OpenAITtsProvider } from "./audio/openai";
import { DemoImageProvider } from "./images/demo";
import { OpenAIImageProvider } from "./images/openai";
import { PollinationsImageProvider } from "./images/pollinations";
import { AlignedSttProvider } from "./stt/fallback";
import { OpenAISTTProvider } from "./stt/openai";

import type { AiProvider } from "@tae/ai";
import type { ImageProvider, SttProvider, TtsProvider } from "./types";

export interface VideoProviderSet {
  image: ImageProvider;
  /** 1차 이미지 제공자가 실패했을 때 쓸 카드 이미지 (데모 모드에서만) */
  imageFallback: ImageProvider | null;
  tts: TtsProvider;
  /** 1차 음성 제공자가 실패했을 때 쓸 배경 음 (데모 모드에서만) */
  ttsFallback: TtsProvider | null;
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
 * 환경변수로 실제 제공자와 키 없는 대체를 고릅니다.
 *   OPENAI_API_KEY             이미지·TTS·STT (실제 결제 경로)
 *   ANTHROPIC_API_KEY          스토리보드(대본) LLM
 *   VIDEO_DEMO=1               키가 있어도 데모만 사용 (렌더 검증용)
 *   VIDEO_DEMO_IMAGE=card      키 없는 이미지를 카드 그림으로만 (기본 pollinations)
 *   VIDEO_DEMO_VOICE=bed       키 없는 음성을 배경 음으로만 (기본 google)
 *   VIDEO_OFFLINE=1            외부 무료 서비스 호출을 모두 끔 (카드·배경 음)
 */
export function createVideoProviders(options: VideoProviderOptions = {}): VideoProviderSet {
  const env = options.env ?? process.env;
  const demo = options.demo ?? env.VIDEO_DEMO === "1";
  const offline = env.VIDEO_OFFLINE === "1";
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
    const card = new DemoImageProvider();
    const bed = new DemoTtsProvider();

    if (offline) {
      warnings.push("OPENAI_API_KEY가 없고 VIDEO_OFFLINE=1이라 카드 이미지·배경 음을 사용합니다.");
      return {
        image: card,
        imageFallback: null,
        tts: bed,
        ttsFallback: null,
        stt: new AlignedSttProvider(),
        storyboard,
        warnings,
        mode: "demo",
      };
    }

    const imageMode = env.VIDEO_DEMO_IMAGE?.trim().toLowerCase();
    const voiceMode = env.VIDEO_DEMO_VOICE?.trim().toLowerCase();

    const image: ImageProvider =
      imageMode === "card" ? card : new PollinationsImageProvider({
        ...(env.POLLINATIONS_IMAGE_URL?.trim() ? { baseUrl: env.POLLINATIONS_IMAGE_URL.trim() } : {}),
        ...(env.POLLINATIONS_MODEL?.trim() ? { model: env.POLLINATIONS_MODEL.trim() } : {}),
      });
    const tts: TtsProvider = voiceMode === "bed" ? bed : new GoogleTtsProvider();

    warnings.push(
      "OPENAI_API_KEY가 없어 키 없는 대체로 생성했습니다. " +
        `이미지: ${image.id === "pollinations" ? "Pollinations 무료 이미지(장면당 최대 45초 대기)" : "카드 이미지"} · ` +
        `음성: ${tts.id === "google" ? "Google 무료 TTS" : "배경 음"}. ` +
        "실제 AI 이미지·음성 품질은 OPENAI_API_KEY를 설정하면 그대로 OpenAI 경로를 씁니다.",
    );

    return {
      image,
      imageFallback: image.id === "demo" ? null : card,
      tts,
      ttsFallback: tts.id === "demo" ? null : bed,
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
  });

  const stt = new OpenAISTTProvider({
    apiKey: openaiKey!,
    ...(env.OPENAI_STT_MODEL?.trim() ? { model: env.OPENAI_STT_MODEL.trim() } : {}),
    ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
  });

  return {
    image,
    imageFallback: null,
    tts,
    ttsFallback: null,
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
