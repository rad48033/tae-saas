import { createTextProviderFromEnv } from "@tae/ai";

import { DemoTtsProvider } from "./audio/demo";
import { GeminiTtsProvider } from "./audio/gemini";
import { GoogleTtsProvider } from "./audio/google";
import { OpenAITtsProvider } from "./audio/openai";
import { DemoImageProvider } from "./images/demo";
import { OpenAIImageProvider } from "./images/openai";
import { PollinationsImageProvider } from "./images/pollinations";
import { AlignedSttProvider } from "./stt/fallback";
import { GeminiSttProvider } from "./stt/gemini";
import { OpenAISTTProvider } from "./stt/openai";

import type { AiProvider } from "@tae/ai";
import type { ImageProvider, SttProvider, TtsProvider } from "./types";

export interface VideoProviderSet {
  image: ImageProvider;
  /** 1차 이미지 제공자가 실패했을 때 쓸 대체 이미지 (카드 이미지 또는 대체 모델) */
  imageFallback: ImageProvider | null;
  tts: TtsProvider;
  /** 1차 음성 제공자가 실패했을 때 쓸 배경 음 (데모·대체 모드에서만) */
  ttsFallback: TtsProvider | null;
  stt: SttProvider;
  /** 스토리보드 LLM. 키가 없으면 undefined → 데모 스토리보드 */
  storyboard: AiProvider | null;
  warnings: string[];
  mode: "openai" | "gemini" | "demo" | "mixed";
}

export interface VideoProviderOptions {
  env?: Record<string, string | undefined>;
  /** 강제로 데모 제공자만 쓸지 */
  demo?: boolean;
  voice?: string;
}

/**
 * 환경변수로 실제 제공자와 키 없는 대체를 고릅니다.
 *   VIDEO_PROVIDER=auto        auto(기본) | openai | gemini | free
 *                              auto: OpenAI 키가 있으면 OpenAI, 없으면 Gemini TTS/전사 + 무료 이미지
 *                              openai: OpenAI 미디어 강제, gemini: Gemini 음성 강제, free: 무료 대체만
 *   OPENAI_API_KEY             이미지·TTS·STT (실제 결제 경로)
 *   GEMINI_API_KEY             TTS·STT·스토리보드 (실제 AI 음성 경로)
 *   ANTHROPIC_API_KEY          스토리보드(대본) LLM
 *   AI_PROVIDER                스토리보드 LLM 강제 선택
 *   VIDEO_DEMO=1               키가 있어도 데모만 사용 (렌더 검증용)
 *   VIDEO_DEMO_IMAGE=card      키 없는 이미지를 카드 그림으로만 (기본 pollinations)
 *   VIDEO_DEMO_VOICE=bed       키 없는 음성을 배경 음으로만 (기본 실제 TTS)
 *   VIDEO_STT=aligned          자막을 전사 없이 결정적 정렬로 고정 (기본: Gemini 전사)
 *   VIDEO_OFFLINE=1            외부 무료 서비스 호출을 모두 끔 (카드·배경 음)
 *
 * 이미지 생성은 무료 한도가 있는 제공자만 키 없이 동작합니다(Pollinations).
 * Gemini 이미지 모델은 유료 등급에서만 열리므로 기본 경로로 쓰지 않습니다.
 */
export function createVideoProviders(options: VideoProviderOptions = {}): VideoProviderSet {
  const env = options.env ?? process.env;
  const demo = options.demo ?? env.VIDEO_DEMO === "1";
  const offline = env.VIDEO_OFFLINE === "1";
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const warnings: string[] = [];

  const rawPreference = env.VIDEO_PROVIDER?.trim().toLowerCase();
  const preference: "auto" | "openai" | "gemini" | "free" =
    rawPreference === "openai" || rawPreference === "gemini" || rawPreference === "free" ? rawPreference : "auto";
  if (rawPreference && preference === "auto") {
    warnings.push(`VIDEO_PROVIDER=${rawPreference} 값을 알 수 없어 auto로 처리했습니다(openai|gemini|free).`);
  }
  if (preference === "openai" && !openaiKey) {
    warnings.push("VIDEO_PROVIDER=openai 이지만 OPENAI_API_KEY가 없어 대체 경로로 렌더합니다.");
  }

  const storyboard = demo ? null : createTextProviderFromEnv(env);

  if (!demo && !storyboard) {
    warnings.push("텍스트 LLM 키(ANTHROPIC_API_KEY·OPENAI_API_KEY·GEMINI_API_KEY)가 없어 데모 스토리보드로 생성했습니다.");
  }

  const useOpenAI = Boolean(openaiKey) && !demo && (preference === "openai" || preference === "auto");
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

    const allowGemini = preference !== "free";

    const image: ImageProvider =
      imageMode === "card"
        ? card
        : new PollinationsImageProvider({
            ...(env.POLLINATIONS_IMAGE_URL?.trim() ? { baseUrl: env.POLLINATIONS_IMAGE_URL.trim() } : {}),
            ...(env.POLLINATIONS_MODEL?.trim() ? { model: env.POLLINATIONS_MODEL.trim() } : {}),
          });

    // 실제 AI 음성: Gemini TTS가 있으면 그걸 쓰고, 없으면 무료 Google TTS → 배경 음 순서.
    const tts: TtsProvider =
      voiceMode === "bed"
        ? bed
        : geminiKey && allowGemini
          ? new GeminiTtsProvider({
              apiKey: geminiKey,
              ...(env.GEMINI_TTS_MODEL?.trim() ? { model: env.GEMINI_TTS_MODEL.trim() } : {}),
              ...(env.GEMINI_TTS_VOICE?.trim() ? { voice: env.GEMINI_TTS_VOICE.trim() } : {}),
              ...(env.GEMINI_TTS_MIN_INTERVAL_MS?.trim()
                ? { minIntervalMs: Math.max(0, Number(env.GEMINI_TTS_MIN_INTERVAL_MS)) }
                : {}),
            })
          : new GoogleTtsProvider();

    // VIDEO_STT=aligned 로 자막을 결정적 정렬로 고정할 수 있습니다(전사 무료 한도가 낮을 때).
    const sttMode = env.VIDEO_STT?.trim().toLowerCase();
    const stt: SttProvider =
      sttMode === "aligned" || !geminiKey || !allowGemini
        ? new AlignedSttProvider()
        : new GeminiSttProvider({
            apiKey: geminiKey,
            ...(env.GEMINI_STT_MODEL?.trim() ? { model: env.GEMINI_STT_MODEL.trim() } : {}),
          });

    const voiceLabel =
      tts.id === "gemini"
        ? `Gemini TTS(${tts.model})`
        : tts.id === "google"
          ? "Google 무료 TTS"
          : "배경 음";
    const sttLabel = stt.id === "gemini" ? `Gemini 전사(${stt.model})` : "결정적 정렬";

    warnings.push(
      (preference === "gemini"
        ? "VIDEO_PROVIDER=gemini 로 OpenAI 미디어를 건너뛰고 실제 AI 음성·전사를 씁니다. "
        : preference === "free"
          ? "VIDEO_PROVIDER=free 로 무료 대체(무료 이미지·무료 음성)만 씁니다. "
          : "OPENAI_API_KEY가 없어 키 없는 대체로 생성했습니다. ") +
        `이미지: ${image.id === "pollinations" ? "Pollinations 무료 이미지(장면당 최대 45초 대기)" : "카드 이미지"} · ` +
        `음성: ${voiceLabel} · 자막: ${sttLabel}. ` +
        "OpenAI 이미지·TTS·Whisper 품질은 OPENAI_API_KEY(결제 크레딧)가 있으면 그대로 OpenAI 경로를 씁니다.",
    );

    return {
      image,
      imageFallback: image.id === "demo" ? null : card,
      tts,
      ttsFallback: tts.id === "demo" ? null : bed,
      stt,
      storyboard,
      warnings,
      mode: tts.id === "gemini" ? "gemini" : "demo",
    };
  }

  const image = new OpenAIImageProvider({
    apiKey: openaiKey!,
    ...(env.OPENAI_IMAGE_MODEL?.trim() ? { model: env.OPENAI_IMAGE_MODEL.trim() } : {}),
    ...(env.OPENAI_IMAGE_QUALITY?.trim() ? { quality: env.OPENAI_IMAGE_QUALITY.trim() } : {}),
    ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
  });

  // 기본 모델이 조직 인증·모델 제공 중단으로 실패할 때를 위한 대체 모델.
  // dall-e-3는 OpenAI에서 더 이상 제공되지 않으므로 (`The model 'dall-e-3' does not exist`)
  // 모델 이름을 하드코딩하지 않고 OPENAI_IMAGE_FALLBACK_MODEL로만 받습니다.
  const fallbackModel = env.OPENAI_IMAGE_FALLBACK_MODEL?.trim();
  const imageFallback: ImageProvider | null = fallbackModel
    ? new OpenAIImageProvider({
        apiKey: openaiKey!,
        model: fallbackModel,
        ...(env.OPENAI_IMAGE_QUALITY?.trim() ? { quality: env.OPENAI_IMAGE_QUALITY.trim() } : {}),
        ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
      })
    : null;

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
    imageFallback,
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
