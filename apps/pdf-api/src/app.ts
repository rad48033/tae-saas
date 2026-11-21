import { estimateCostUsd } from "@tae/ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import type { AppDeps } from "./lib/deps";
import { ApiError, toErrorResponse } from "./lib/errors";
import { fetchPdfFromUrl, parseConversionRequest } from "./lib/parse-request";
import { creditsForPages, extractPdf } from "./lib/pdf";
import { createAdminAuth, createApiKeyAuth } from "./middleware/auth";
import { createRateLimiter } from "./middleware/rate-limit";
import type { AppEnv } from "./types";

export const API_VERSION = "0.1.0";

const createKeySchema = z.object({
  email: z.string().email(),
  name: z.string().max(80).optional(),
  credits: z.number().int().min(0).max(100_000).optional(),
});

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const requireApiKey = createApiKeyAuth(deps.store);
  const requireAdmin = createAdminAuth(deps.config.adminToken);
  const rateLimit = createRateLimiter(deps.config.rateLimit);

  app.use("*", async (c, next) => {
    const requestId = (c.req.header("x-request-id") ?? crypto.randomUUID()).slice(0, 64);
    c.set("requestId", requestId);
    c.set("startedAt", Date.now());
    c.header("X-Request-Id", requestId);
    c.header("X-Api-Version", API_VERSION);
    await next();
  });

  app.use(
    "*",
    cors({
      origin: (origin) => {
        const allowed = deps.config.allowedOrigins;
        if (allowed.includes("*")) return origin ?? "*";
        return allowed.includes(origin) ? origin : allowed[0] ?? "";
      },
      allowHeaders: ["Authorization", "Content-Type", "X-API-Key", "X-Request-Id", "X-Filename"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      exposeHeaders: ["X-Request-Id", "X-Credits-Charged", "X-Credits-Remaining"],
      maxAge: 86_400,
    }),
  );

  app.get("/", (c) =>
    c.json({
      name: "tae-pdf-api",
      version: API_VERSION,
      description: "PDF에서 텍스트를 추출하고, Claude로 원하는 JSON 스키마에 맞춰 구조화합니다.",
      endpoints: {
        "GET /health": "서비스 상태",
        "GET /v1/me": "내 크레딧·키 정보 (API 키 필요)",
        "POST /v1/convert": "PDF 변환 (API 키 필요)",
        "GET /v1/jobs/:id": "작업 상태 (API 키 필요)",
        "POST /v1/keys": "API 키 발급 (관리자 토큰 필요)",
      },
      docs: "https://github.com/rad48033/tae-saas/blob/main/docs/API.md",
    }),
  );

  app.get("/health", async (c) => {
    const healthy = await deps.store.checkHealth().catch(() => false);
    return c.json(
      {
        status: healthy ? "ok" : "degraded",
        version: API_VERSION,
        time: new Date().toISOString(),
        services: { store: deps.config.storeMode, ai: deps.config.aiMode, model: deps.config.aiModel },
      },
      healthy ? 200 : 503,
    );
  });

  app.get("/v1/me", requireApiKey, async (c) => {
    const user = c.get("user");
    const apiKey = c.get("apiKey");
    const balance = await deps.store.getBalance(user.id);

    return c.json({
      user: { id: user.id, email: user.email },
      credits: {
        balance: balance.balance,
        lifetimeGranted: balance.lifetimeGranted,
        lifetimeUsed: balance.lifetimeUsed,
      },
      apiKey: {
        name: apiKey.name,
        prefix: apiKey.prefix,
        lastUsedAt: apiKey.lastUsedAt,
        createdAt: apiKey.createdAt,
      },
      services: { store: deps.config.storeMode, ai: deps.config.aiMode },
    });
  });

  app.get("/v1/jobs/:id", requireApiKey, async (c) => {
    const user = c.get("user");
    const job = await deps.store.getJob(c.req.param("id"));
    if (!job || job.userId !== user.id) {
      throw new ApiError("not_found", "작업을 찾을 수 없습니다.", 404);
    }
    return c.json({
      job: {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        creditsCharged: job.creditsCharged,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        input: job.input,
        output: job.output,
      },
    });
  });

  app.post("/v1/keys", requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createKeySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError("invalid_request", "`email`은 필수입니다.", 400, parsed.error.issues);
    }

    const user = await deps.store.getOrCreateUserByEmail(parsed.data.email, null);
    if (parsed.data.credits && parsed.data.credits > 0) {
      await deps.store.grantCredits({
        userId: user.id,
        amount: parsed.data.credits,
        kind: "adjustment",
        description: "관리자 지급 크레딧",
      });
    }

    const { record, secret } = await deps.store.createApiKey({
      userId: user.id,
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
    });
    const balance = await deps.store.getBalance(user.id);

    return c.json(
      {
        // 평문 키는 이 응답에서 한 번만 노출됩니다.
        key: secret,
        apiKey: { id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt },
        user: { id: user.id, email: user.email },
        credits: { balance: balance.balance },
      },
      201,
    );
  });

  app.post("/v1/convert", requireApiKey, rateLimit, async (c) => {
    const startedAt = Date.now();
    const user = c.get("user");
    const parsed = await parseConversionRequest(c.req.raw, { maxUploadBytes: deps.config.maxUploadBytes });
    const options = parsed.options;

    const job = await deps.store.createJob({
      userId: user.id,
      app: "pdf_api",
      status: "running",
      input: {
        sourceName: parsed.sourceName,
        mode: options.mode,
        schema: options.schema,
        viaUrl: Boolean(parsed.url),
      },
    });

    let creditsCharged = 0;
    let creditsRemaining = (await deps.store.getBalance(user.id)).balance;

    try {
      const bytes = parsed.bytes ?? (await fetchBytesFromUrl(parsed.url, deps));
      const extracted = await extractPdf(bytes, {
        maxPages: deps.config.maxPages,
        workerPath: deps.config.pdfWorkerPath,
      });

      if (extracted.characterCount === 0) {
        throw new ApiError(
          "pdf_parse_failed",
          "PDF에서 텍스트를 찾지 못했습니다. 스캔 이미지로만 된 PDF는 OCR이 필요합니다.",
          422,
        );
      }

      const required = creditsForPages(extracted.pageCount);
      const consumed = await deps.store.consumeCredits({
        userId: user.id,
        amount: required,
        jobId: job.id,
        description: `PDF ${extracted.pageCount}페이지 변환`,
      });

      if (!consumed.ok) {
        throw new ApiError(
          "insufficient_credits",
          `크레딧이 부족합니다. 필요 ${required}크레딧, 보유 ${consumed.balance}크레딧.`,
          402,
          { requiredCredits: required, balance: consumed.balance },
        );
      }

      creditsCharged = required;
      creditsRemaining = consumed.balance;

      let data: unknown;
      let provider = "deterministic";
      let model = "pdfjs";
      let inputTokens = 0;
      let outputTokens = 0;

      if (options.mode === "text") {
        data = { pages: extracted.pages };
      } else {
        const result = await deps.ai.structurePdf({
          pages: extracted.pages,
          schema: options.schema,
          ...(options.language ? { language: options.language } : {}),
          ...(options.instructions ? { instructions: options.instructions } : {}),
          sourceName: parsed.sourceName,
        });
        data = result.data;
        provider = result.provider;
        model = result.model;
        inputTokens = result.usage.inputTokens;
        outputTokens = result.usage.outputTokens;
      }

      const durationMs = Date.now() - startedAt;
      const costUsd = estimateCostUsd(model, { inputTokens, outputTokens });

      await deps.store.updateJob(job.id, {
        status: "succeeded",
        output: {
          schema: options.mode === "text" ? "text" : options.schema,
          pageCount: extracted.pageCount,
          title: extracted.title,
        },
        provider,
        model,
        creditsCharged,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
        completedAt: new Date().toISOString(),
      });

      c.header("X-Credits-Charged", String(creditsCharged));
      c.header("X-Credits-Remaining", String(creditsRemaining));

      return c.json(
        {
          jobId: job.id,
          status: "succeeded" as const,
          document: {
            pageCount: extracted.pageCount,
            characters: extracted.characterCount,
            mode: options.mode,
            schema: options.mode === "text" ? null : options.schema,
            title: extracted.title,
            author: extracted.author,
          },
          data,
          usage: { creditsCharged, creditsRemaining, inputTokens, outputTokens, costUsd },
          meta: { provider, model, durationMs },
        },
        200,
      );
    } catch (error) {
      if (creditsCharged > 0) {
        await deps.store
          .refundCredits({ userId: user.id, amount: creditsCharged, jobId: job.id })
          .catch((refundError: unknown) => {
            console.error(`[pdf-api] ${c.get("requestId")} 크레딧 환불 실패`, refundError);
          });
      }

      const apiError = mapError(error);
      await deps.store
        .updateJob(job.id, {
          status: "failed",
          errorCode: apiError.code,
          errorMessage: apiError.message,
          creditsCharged,
          durationMs: Date.now() - startedAt,
          completedAt: new Date().toISOString(),
        })
        .catch(() => undefined);

      throw apiError;
    }
  });

  app.notFound((c) =>
    c.json(toErrorResponse(new ApiError("not_found", "없는 엔드포인트입니다.", 404), c.get("requestId") ?? "unknown"), 404),
  );

  app.onError((error, c) => {
    const requestId = c.get("requestId") ?? "unknown";
    if (error instanceof ApiError) {
      return c.json(toErrorResponse(error, requestId), error.status);
    }

    console.error(`[pdf-api] ${requestId}`, error);
    return c.json(
      toErrorResponse(new ApiError("internal_error", "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500), requestId),
      500,
    );
  });

  return app;
}

async function fetchBytesFromUrl(url: string | undefined, deps: AppDeps): Promise<Uint8Array> {
  if (!url) throw new ApiError("invalid_request", "PDF 소스가 없습니다.", 400);
  const result = await fetchPdfFromUrl(url, { maxBytes: deps.config.maxUploadBytes });
  return result.bytes;
}

function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && error.name === "AiResponseError") {
    return new ApiError("ai_failed", "AI가 요청한 JSON 형식을 만들지 못했습니다. 다시 시도해 주세요.", 502);
  }
  if (error instanceof Error && /aborted|timeout/i.test(error.message)) {
    return new ApiError("ai_failed", "AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
  }
  return new ApiError("internal_error", "PDF 변환 중 알 수 없는 오류가 발생했습니다.", 500);
}

