import { NextResponse } from "next/server";
import { z } from "zod";

import { estimateCostUsd, OUTPUTS_BY_SOURCE, type SourceType } from "@tae/ai";

import { AppError, toApiError } from "@/lib/app-error";
import { enforceRateLimit } from "@/lib/rate-limit";
import { CONVERT_COST, getRuntime, VIDEO_CONVERT_COST } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";
import { resolveSource } from "@/lib/source-input";
import { createStoryboard } from "@/lib/storyboard";
import { buildVideoPackage, getVideoConfig } from "@/lib/video";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  sourceType: z.enum(["youtube", "blog", "instagram"]).default("youtube"),
  url: z.string().max(1000).optional(),
  /** 붙여넣은 원문(자막·본문·캡션) */
  text: z.string().max(200_000).optional(),
  /** 이전 UI 호환: 자막 전용 필드 */
  transcript: z.string().max(200_000).optional(),
  title: z.string().max(200).optional(),
  author: z.string().max(120).optional(),
  format: z.enum(["blog", "instagram", "facebook", "youtube_video"]).default("blog"),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  language: z.enum(["ko", "en"]).default("ko"),
  focusKeyword: z.string().max(80).optional(),
  audience: z.string().max(120).optional(),
});

export async function POST(request: Request) {
  const runtime = getRuntime();
  const { store, ai } = runtime;

  let jobId: string | null = null;
  let charged = 0;

  try {
    const { user } = await ensureUser();
    enforceRateLimit(`convert:${user.id}`);

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "요청 형식이 올바르지 않습니다.", 400, parsed.error.issues);
    }
    const body = parsed.data;

    const allowed = OUTPUTS_BY_SOURCE[body.sourceType];
    if (!(allowed as readonly string[]).includes(body.format)) {
      throw new AppError(
        "invalid_request",
        `${body.sourceType} 입력으로는 ${body.format} 결과를 만들 수 없습니다. 가능한 형식: ${allowed.join(", ")}`,
        400,
        { allowedFormats: allowed },
      );
    }

    const cost = body.format === "youtube_video" ? VIDEO_CONVERT_COST : CONVERT_COST;
    const balance = await store.getBalance(user.id);
    if (balance.balance < cost) {
      throw new AppError(
        "insufficient_credits",
        "크레딧이 부족합니다. 아래 요금제에서 크레딧을 충전해 주세요.",
        402,
        { requiredCredits: cost, balance: balance.balance },
      );
    }

    const job = await store.createJob({
      userId: user.id,
      app: "youtube_blog",
      status: "running",
      input: {
        sourceType: body.sourceType,
        format: body.format,
        aspectRatio: body.format === "youtube_video" ? body.aspectRatio : null,
        language: body.language,
        hasUrl: Boolean(body.url),
        pastedChars: (body.text ?? body.transcript ?? "").length,
      },
    });
    jobId = job.id;

    const consumed = await store.consumeCredits({
      userId: user.id,
      amount: cost,
      jobId: job.id,
      description:
        body.format === "youtube_video"
          ? `${body.sourceType} → 유튜브 영상(${body.aspectRatio})`
          : `${body.sourceType} → ${body.format}`,
    });
    if (!consumed.ok) {
      throw new AppError("insufficient_credits", "크레딧이 부족합니다.", 402, {
        requiredCredits: cost,
        balance: consumed.balance,
      });
    }
    charged = cost;

    const startedAt = Date.now();
    const resolved = await resolveSource({
      sourceType: body.sourceType as SourceType,
      url: body.url,
      text: body.text,
      transcript: body.transcript,
      title: body.title,
      author: body.author,
      language: body.language,
    });
    const { source } = resolved;

    const sourcePayload = {
      sourceType: source.sourceType,
      title: source.title,
      author: source.author,
      url: source.url ?? null,
      thumbnailUrl: source.thumbnailUrl ?? null,
      textChars: source.text.length,
      textSource: resolved.meta.textSource,
      warnings: resolved.warnings,
    };

    if (body.format === "youtube_video") {
      const storyboardResult = await createStoryboard(source, body.aspectRatio, body.language);
      const videoPackage = buildVideoPackage(storyboardResult.storyboard, getVideoConfig());
      const durationMs = Date.now() - startedAt;
      const costUsd = estimateCostUsd(storyboardResult.model, storyboardResult.usage);

      await store.updateJob(job.id, {
        status: "succeeded",
        output: {
          format: "youtube_video",
          aspectRatio: body.aspectRatio,
          scenes: storyboardResult.storyboard.scenes.length,
          durationSeconds: videoPackage.preset.totalSeconds,
          renderMode: videoPackage.render.mode,
        },
        provider: storyboardResult.provider,
        model: storyboardResult.model,
        creditsCharged: charged,
        inputTokens: storyboardResult.usage.inputTokens,
        outputTokens: storyboardResult.usage.outputTokens,
        costUsd,
        durationMs,
        completedAt: new Date().toISOString(),
      });

      return NextResponse.json({
        jobId: job.id,
        format: "youtube_video",
        source: sourcePayload,
        draft: null,
        video: videoPackage,
        credits: { remaining: consumed.balance, charged },
        meta: {
          provider: storyboardResult.provider,
          model: storyboardResult.model,
          mode: runtime.aiMode,
          inputTokens: storyboardResult.usage.inputTokens,
          outputTokens: storyboardResult.usage.outputTokens,
          costUsd,
          durationMs,
          warnings: [...resolved.warnings, ...storyboardResult.warnings],
        },
      });
    }

    const result = await ai.generateContent({
      source,
      target: {
        language: body.language,
        format: body.format,
        ...(body.focusKeyword ? { focusKeyword: body.focusKeyword } : {}),
        ...(body.audience ? { audience: body.audience } : {}),
      },
    });

    const durationMs = Date.now() - startedAt;
    const costUsd = estimateCostUsd(result.model, result.usage);

    await store.updateJob(job.id, {
      status: "succeeded",
      output: { format: result.draft.format, provider: result.provider, sourceTitle: source.title },
      provider: result.provider,
      model: result.model,
      creditsCharged: charged,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd,
      durationMs,
      completedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      jobId: job.id,
      format: result.draft.format,
      source: sourcePayload,
      draft: result.draft,
      video: null,
      credits: { remaining: consumed.balance, charged },
      meta: {
        provider: result.provider,
        model: result.model,
        mode: runtime.aiMode,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd,
        durationMs,
        textChars: source.text.length,
        textLanguage: source.language,
        textSource: resolved.meta.textSource,
        warnings: resolved.warnings,
      },
    });
  } catch (error) {
    if (jobId) {
      if (charged > 0) {
        const { store: refundStore } = runtime;
        try {
          const userId = (await refundStore.getJob(jobId))?.userId;
          if (userId) await refundStore.refundCredits({ userId, amount: charged, jobId });
        } catch {
          // 환불 실패는 원래 오류를 가리지 않습니다.
        }
      }

      const apiError = toApiError(error);
      await runtime.store
        .updateJob(jobId, {
          status: "failed",
          errorCode: apiError.code,
          errorMessage: apiError.message,
          creditsCharged: 0,
          completedAt: new Date().toISOString(),
        })
        .catch(() => undefined);

      return NextResponse.json(
        { error: { code: apiError.code, message: apiError.message, details: apiError.details ?? null } },
        { status: apiError.status },
      );
    }

    const apiError = toApiError(error);
    if (apiError.status >= 500) console.error("[youtube-blog] convert 실패", error);
    return NextResponse.json(
      { error: { code: apiError.code, message: apiError.message, details: apiError.details ?? null } },
      { status: apiError.status },
    );
  }
}
