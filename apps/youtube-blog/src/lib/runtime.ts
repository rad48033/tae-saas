import { createAiServiceFromEnv, type AiMode, type AiService } from "@tae/ai";
import { createStoreFromEnv, type Store } from "@tae/db";
import { loadBillingConfig, type BillingConfig } from "@tae/stripe";

export interface Runtime {
  store: Store;
  ai: AiService;
  storeMode: "supabase" | "memory";
  aiMode: AiMode;
  aiModel: string;
  warning?: string;
}

const globalRuntime = globalThis as unknown as { __taeYoutubeBlogRuntime?: Runtime };

/** Next dev의 핫 리로드에서도 Supabase/AI 클라이언트를 한 번만 만듭니다. */
export function getRuntime(): Runtime {
  if (!globalRuntime.__taeYoutubeBlogRuntime) {
    const selection = createStoreFromEnv();
    // AI_PROVIDER → ANTHROPIC → OPENAI → GEMINI → demo 순서로 고릅니다.
    const ai = createAiServiceFromEnv(process.env);

    globalRuntime.__taeYoutubeBlogRuntime = {
      store: selection.store,
      ai,
      storeMode: selection.mode,
      aiMode: ai.mode,
      aiModel: ai.model,
      ...(selection.warning ? { warning: selection.warning } : {}),
    };
  }

  return globalRuntime.__taeYoutubeBlogRuntime;
}

export function getBillingConfig(): BillingConfig {
  return loadBillingConfig(process.env);
}

export const TRIAL_CREDITS = Math.max(0, Number(process.env.TRIAL_CREDITS ?? 10));

/** 글 1편(한 형식) 크레딧 */
export const CONVERT_COST = 1;

/**
 * 글 3종(블로그·인스타·페이스북)을 한 번에 만들 때의 크레딧.
 * 원가가 편당 50~90원이라 세 편을 묶어도 1크레딧으로 받습니다.
 */
export const TEXT_SET_COST = CONVERT_COST;

/**
 * 영상 1편(스토리보드 → MP4 렌더)의 총 크레딧. 수익화 플랜 v2 기준 9.
 * 기획(스토리보드·대본·자막)과 렌더(이미지·음성·ffmpeg)를 나눠 받아
 * "스토리보드만 보고 그만두는" 사용자에게 공정하게 계산합니다.
 */
export const VIDEO_CONVERT_COST = Math.max(1, Number(process.env.VIDEO_CONVERT_COST ?? 9));

/** 영상 기획(스토리보드·대본·자막) 크레딧 */
export const VIDEO_STORYBOARD_COST = Math.min(
  VIDEO_CONVERT_COST,
  Math.max(0, Number(process.env.VIDEO_STORYBOARD_COST ?? 3)),
);

/** MP4 렌더 크레딧 = 영상 총 크레딧 - 기획 크레딧 */
export const VIDEO_RENDER_COST = Math.max(0, VIDEO_CONVERT_COST - VIDEO_STORYBOARD_COST);

/** 미리보기 렌더(저해상도, 원가 60~150원) 크레딧 */
export const VIDEO_PREVIEW_COST = Math.max(
  0,
  Number(process.env.VIDEO_PREVIEW_COST ?? 1),
);

/** UI·/api/credits가 함께 쓰는 차감 기준표 */
export const CREDIT_COSTS = {
  text: CONVERT_COST,
  textSet: TEXT_SET_COST,
  videoStoryboard: VIDEO_STORYBOARD_COST,
  videoRender: VIDEO_RENDER_COST,
  videoPreview: VIDEO_PREVIEW_COST,
  videoTotal: VIDEO_CONVERT_COST,
  pdfPagesPerCredit: 10,
  trial: TRIAL_CREDITS,
} as const;

export type CreditCosts = typeof CREDIT_COSTS;
