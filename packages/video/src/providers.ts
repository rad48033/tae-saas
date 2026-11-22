import { createTextProviderFromEnv } from "@tae/ai";

import { DemoTtsProvider } from "./audio/demo";
import { GeminiTtsProvider } from "./audio/gemini";
import { GoogleTtsProvider } from "./audio/google";
import { OpenAITtsProvider } from "./audio/openai";
import { DemoImageProvider } from "./images/demo";
import { DEFAULT_IMAGE_FALLBACK_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_QUALITY, OpenAIImageProvider, imageSizeFor } from "./images/openai";
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
 *   OPENAI_IMAGE_QUALITY       이미지 품질 low|medium|high|auto (기본 high)
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

  const imageQuality = env.OPENAI_IMAGE_QUALITY?.trim() || DEFAULT_IMAGE_QUALITY;
  const image = new OpenAIImageProvider({
    apiKey: openaiKey!,
    model: env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL,
    quality: imageQuality,
    ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
  });

  // 기본 모델이 조직 인증·모델 제공 중단으로 실패할 때를 위한 대체 모델.
  // dall-e-3는 OpenAI에서 더 이상 제공되지 않으므로 (`The model 'dall-e-3' does not exist`)
  // 모델 이름을 하드코딩하지 않고 OPENAI_IMAGE_FALLBACK_MODEL로 받습니다.
  // 비워 두면 gpt-image-1-mini로 대체합니다(같은 계정에서 확인된 모델).
  const fallbackModel = env.OPENAI_IMAGE_FALLBACK_MODEL?.trim() || DEFAULT_IMAGE_FALLBACK_MODEL;
  const imageFallback: ImageProvider | null = fallbackModel
    ? new OpenAIImageProvider({
        apiKey: openaiKey!,
        model: fallbackModel,
        quality: imageQuality,
        ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
      })
    : null;
  // 릴스 템포: gpt-4o-mini-tts · alloy · 1.25배속이 기본입니다.
  const tts = new OpenAITtsProvider({
    apiKey: openaiKey!,
    ...(env.OPENAI_TTS_MODEL?.trim() ? { model: env.OPENAI_TTS_MODEL.trim() } : {}),
    voice: resolveVoice(options.voice, env),
    speed: resolveTtsSpeed(env),
    ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
  });

  const stt = new OpenAISTTProvider({
    apiKey: openaiKey!,
    model: resolveSttModel(env),
    ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
  });

  // 실제로 쓸 조합을 한 줄로 남깁니다(로그·manifest에서 바로 확인).
  warnings.push(
    `OpenAI 미디어: 이미지 ${image.model} ${imageSizeFor(image.model, "9:16")}(9:16)·${imageSizeFor(image.model, "16:9")}(16:9) 네이티브, 품질 ${image.qualityLabel} · ` +
      `음성 ${tts.model} ${tts.voice} ${tts.speed ?? 1}배속 · 자막 ${resolveSttModel(env)}.`,
  );
  if (image.qualityLabel === "high") {
    warnings.push(
      "이미지 품질 high는 장당 약 200~330원(1088x1920)입니다. 비용을 아끼려면 OPENAI_IMAGE_QUALITY=medium|low로 낮추세요.",
    );
  }

  const sttModel = resolveSttModel(env);
  if (!sttModel.startsWith("whisper")) {
    warnings.push(
      `OPENAI_STT_MODEL=${sttModel} 은 단어 타임스탬프를 주지 않아 자막이 구간 단위로 뭉칩니다. 릴스 자막은 whisper-1을 권합니다.`,
    );
  }

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

/**
 * TTS 배속. 기본 1.25배속은 릴스 템포에 맞춘 값입니다.
 * OPENAI_TTS_SPEED=1 로 두면 원속으로 되돌립니다.
 */
export function resolveTtsSpeed(env: Record<string, string | undefined> = process.env): number {
  const raw = env.OPENAI_TTS_SPEED?.trim();
  const parsed = raw ? Number(raw) : 1.25;
  if (!Number.isFinite(parsed) || parsed <= 0) return 1.25;
  return parsed;
}

/**
 * 자막 전사 기본값. 단어 타임스탬프가 있는 whisper-1만 어절 중간에서 끊기지 않는 자막을 만듭니다.
 * (gpt-4o-mini-transcribe·gpt-4o-transcribe는 문장만 주므로 구간(segment)으로 대체됩니다.)
 */
export function resolveSttModel(env: Record<string, string | undefined> = process.env): string {
  return env.OPENAI_STT_MODEL?.trim() || "whisper-1";
}
