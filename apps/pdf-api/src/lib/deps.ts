import { createAiServiceFromEnv, type AiMode, type AiService } from "@tae/ai";
import { createStoreFromEnv, type Store } from "@tae/db";
import { loadBillingConfig, type BillingConfig } from "@tae/stripe";

export interface AppConfig {
  storeMode: "supabase" | "memory";
  aiMode: AiMode;
  aiModel: string;
  storeWarning?: string;
  billing: BillingConfig;
  adminToken: string | null;
  allowedOrigins: string[];
  maxUploadBytes: number;
  maxPages: number;
  rateLimit: { limit: number; windowMs: number };
  pdfWorkerPath: string | null;
}

export interface AppDeps {
  store: Store;
  ai: AiService;
  config: AppConfig;
}

export function createDeps(env: Record<string, string | undefined> = process.env): AppDeps {
  const selection = createStoreFromEnv(env);
  // AI_PROVIDER → ANTHROPIC → OPENAI → GEMINI → demo 순서로 고릅니다.
  const ai = createAiServiceFromEnv(env);

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    store: selection.store,
    ai,
    config: {
      storeMode: selection.mode,
      aiMode: ai.mode,
      aiModel: ai.model,
      ...(selection.warning ? { storeWarning: selection.warning } : {}),
      billing: loadBillingConfig(env),
      adminToken: env.PDF_API_ADMIN_TOKEN?.trim() || null,
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ["*"],
      maxUploadBytes: Number(env.PDF_MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024),
      maxPages: Number(env.PDF_MAX_PAGES ?? 200),
      rateLimit: {
        limit: Number(env.PDF_RATE_LIMIT ?? 30),
        windowMs: Number(env.PDF_RATE_WINDOW_MS ?? 60_000),
      },
      pdfWorkerPath: env.PDF_WORKER_PATH?.trim() || null,
    },
  };
}
