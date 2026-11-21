import { readFile } from "node:fs/promises";

import { createAiService, type AiService } from "@tae/ai";
import { MemoryStore, type ApiKeyRecord } from "@tae/db";
import { createApp } from "../src/app";
import type { AppDeps } from "../src/lib/deps";

export interface TestContext {
  app: ReturnType<typeof createApp>;
  store: MemoryStore;
  userId: string;
  apiKey: ApiKeyRecord;
  secret: string;
}

export function createTestConfig(): AppDeps["config"] {
  return {
    storeMode: "memory",
    aiMode: "demo",
    aiModel: "demo-heuristic",
    billing: {
      apiKey: null,
      storeId: null,
      storeSlug: "taest",
      webhookSecret: null,
      variants: {},
    },
    adminToken: "admin_test_token",
    allowedOrigins: ["*"],
    maxUploadBytes: 15 * 1024 * 1024,
    maxPages: 50,
    rateLimit: { limit: 100, windowMs: 60_000 },
    pdfWorkerPath: null,
  };
}

export async function setup(options: { credits?: number; ai?: AiService } = {}): Promise<TestContext> {
  const store = new MemoryStore();
  const user = await store.createUser({ email: "user@example.com" });
  if (options.credits && options.credits > 0) {
    await store.grantCredits({ userId: user.id, amount: options.credits, kind: "purchase" });
  }

  const { record, secret } = await store.createApiKey({ userId: user.id, name: "test" });
  const deps: AppDeps = {
    store,
    ai: options.ai ?? createAiService(),
    config: createTestConfig(),
  };

  return { app: createApp(deps), store, userId: user.id, apiKey: record, secret };
}

export async function readFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
  return new Uint8Array(buffer);
}

export function authHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}` };
}

export function pdfForm(bytes: Uint8Array, options: Record<string, string> = {}): FormData {
  const form = new FormData();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set("file", new File([buffer], "invoice.pdf", { type: "application/pdf" }));
  for (const [key, value] of Object.entries(options)) form.set(key, value);
  return form;
}

export function fakeAi(overrides: Partial<AiService> = {}): AiService {
  return {
    mode: "anthropic",
    model: "fake-model",
    async generateContent() {
      throw new Error("not used in pdf-api tests");
    },
    async structurePdf(input) {
      return {
        schema: input.schema,
        data: {
          documentType: input.schema,
          invoiceNumber: "INV-2026-0042",
          total: "1,362.90",
        } as never,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: { inputTokens: 1200, outputTokens: 320 },
        repaired: false,
      };
    },
    ...overrides,
  } as AiService;
}
