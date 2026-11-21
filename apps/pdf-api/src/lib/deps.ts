import { createAiService, type AiService } from "@tae/ai";
import { createStoreFromEnv, type Store } from "@tae/db";
import { loadBillingConfig, type BillingConfig } from "@tae/stripe";

export interface AppConfig {
  storeMode: "supabase" | "memory";
  aiMode: "anthropic" | "demo";
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
  const ai = createAiService({
    apiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    model: env.ANTHROPIC_MODEL?.trim() || undefined,
  });

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
