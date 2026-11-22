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

export const TRIAL_CREDITS = Math.max(0, Number(process.env.TRIAL_CREDITS ?? 2));

export const CONVERT_COST = 1;

// 영상 생성은 이미지·음성 API 비용이 들어 기본 단가를 따로 둡니다(환경변수로 조정).
export const VIDEO_CONVERT_COST = Math.max(1, Number(process.env.VIDEO_CONVERT_COST ?? 1));
