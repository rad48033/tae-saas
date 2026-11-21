import { createAiService, type AiService } from "@tae/ai";
import { createStoreFromEnv, type Store } from "@tae/db";
import { loadBillingConfig, type BillingConfig } from "@tae/stripe";

export interface Runtime {
  store: Store;
  ai: AiService;
  storeMode: "supabase" | "memory";
  aiMode: "anthropic" | "demo";
  warning?: string;
}

const globalRuntime = globalThis as unknown as { __taeYoutubeBlogRuntime?: Runtime };

/** Next dev의 핫 리로드에서도 Supabase/Claude 클라이언트를 한 번만 만듭니다. */
export function getRuntime(): Runtime {
  if (!globalRuntime.__taeYoutubeBlogRuntime) {
    const selection = createStoreFromEnv();
    const ai = createAiService({
      apiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
      model: process.env.ANTHROPIC_MODEL?.trim() || undefined,
    });

    globalRuntime.__taeYoutubeBlogRuntime = {
      store: selection.store,
      ai,
      storeMode: selection.mode,
      aiMode: ai.mode,
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
