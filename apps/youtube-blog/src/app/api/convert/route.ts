import { NextResponse } from "next/server";
import { z } from "zod";

import { estimateCostUsd, OUTPUTS_BY_SOURCE, type SourceType } from "@tae/ai";

import { AppError, toApiError } from "@/lib/app-error";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  CONVERT_COST,
  getRuntime,
  TEXT_SET_COST,
  VIDEO_STORYBOARD_COST,
} from "@/lib/runtime";
import { ensureUser } from "@/lib/session";
import { resolveSource } from "@/lib/source-input";
import { createStoryboard } from "@/lib/storyboard";
import { buildVideoPackage, getVideoConfig } from "@/lib/video";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const TEXT_FORMATS = ["blog", "instagram", "facebook"] as const;
type TextFormat = (typeof TEXT_FORMATS)[number];

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
  /** 글 3종을 한 번에 만들 때(1크레딧). 지정하면 format은 무시합니다. */
  formats: z.array(z.enum(TEXT_FORMATS)).min(1).max(3).optional(),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  language: z.enum(["ko", "en"]).default("ko"),
  focusKeyword: z.string().max(80).optional(),
  audience: z.string().max(120).optional(),
  /** 실제 제품·공간 사진 주소. 영상 생성 시 참조 이미지로 써서 실제 패키지를 유지합니다. */
  referenceImages: z.array(z.string().max(2000)).max(6).optional(),
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
    const isVideo = body.format === "youtube_video" && !body.formats;
    const textFormats: TextFormat[] = body.formats
      ? Array.from(new Set(body.formats))
      : isVideo
        ? []
        : [body.format as TextFormat];

    for (const format of textFormats) {
      if (!(allowed as readonly string[]).includes(format)) {
        throw new AppError(
          "invalid_request",
          `${body.sourceType} 입력으로는 ${format} 결과를 만들 수 없습니다. 가능한 형식: ${allowed.join(", ")}`,
          400,
          { allowedFormats: allowed },
        );
      }
    }

    const cost = isVideo ? VIDEO_STORYBOARD_COST : textFormats.length > 1 ? TEXT_SET_COST : CONVERT_COST;
    const balance = await store.getBalance(user.id);
    if (balance.balance < cost) {
      throw new AppError(
        "insufficient_credits",
        "크레딧이 부족합니다. 크레딧 탭에서 충전해 주세요.",
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
        format: isVideo ? "youtube_video" : textFormats[0],
        formats: isVideo ? ["youtube_video"] : textFormats,
        aspectRatio: isVideo ? body.aspectRatio : null,
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
      description: isVideo
        ? `${body.sourceType} → 영상 기획(${body.aspectRatio})`
        : textFormats.length > 1
          ? `${body.sourceType} → 글 3종(${textFormats.join("·")})`
          : `${body.sourceType} → ${textFormats[0]}`,
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
      imageCount: resolved.meta.imageCount,
      warnings: resolved.warnings,
    };

    if (isVideo) {
      // 사용자가 넣은 제품 사진이 있으면 그것을, 없으면 원본 페이지에서 확보한 사진을 씁니다.
      const explicitReferences = (body.referenceImages ?? [])
        .map((url) => url.trim())
        .filter((url) => /^https?:\/\//i.test(url))
        .map((url, index) => ({ url, label: `제품 사진 ${index + 1}` }));
      const autoReferences = (source.imageUrls ?? [])
        .filter((url) => !explicitReferences.some((reference) => reference.url === url))
        .map((url, index) => ({ url, label: `원본 게시물 사진 ${index + 1}` }));
      const referenceImages = [...explicitReferences, ...autoReferences].slice(0, 6);

      const storyboardResult = await createStoryboard(source, body.aspectRatio, body.language, referenceImages);
      const videoPackage = buildVideoPackage(storyboardResult.storyboard, getVideoConfig());
      const durationMs = Date.now() - startedAt;
      const costUsd = estimateCostUsd(storyboardResult.model, storyboardResult.usage);

      const videoPayload = {
        jobId: job.id,
        format: "youtube_video" as const,
        formats: ["youtube_video" as const],
        source: sourcePayload,
        draft: null,
        drafts: {},
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
          warnings: [
            ...resolved.warnings,
            ...storyboardResult.warnings,
            ...(referenceImages.length > 0
              ? [`실제 사진 ${referenceImages.length}장을 참조 이미지로 넣었습니다. 렌더 시 제품 외관이 그대로 유지됩니다.`]
              : []),
          ],
        },
      };

      await store.updateJob(job.id, {
        status: "succeeded",
        output: {
          format: "youtube_video",
          aspectRatio: body.aspectRatio,
          scenes: storyboardResult.storyboard.scenes.length,
          durationSeconds: videoPackage.preset.totalSeconds,
          renderMode: videoPackage.render.mode,
          referenceImages: referenceImages.length,
          sourceTitle: source.title,
          // 로그인 계정의 보관함(/api/jobs/{id})에서 다시 열 수 있도록 결과 원문을 남깁니다.
          result: videoPayload,
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

      return NextResponse.json(videoPayload);
    }

    // 글 3종은 한 요청에서 동시에 만듭니다(순차로 하면 60초를 넘겨 시간 초과가 납니다).
    // 한 형식이 실패해도 나머지는 살려서 돌려주고, 전부 실패했을 때만 오류로 처리합니다.
    const settled = await Promise.allSettled(
      textFormats.map((format) =>
        ai.generateContent({
          source,
          target: {
            language: body.language,
            format,
            ...(body.focusKeyword ? { focusKeyword: body.focusKeyword } : {}),
            ...(body.audience ? { audience: body.audience } : {}),
          },
        }),
      ),
    );

    const drafts: Partial<Record<TextFormat, unknown>> = {};
    const failedFormats: TextFormat[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let provider = "";
    let model = "";

    settled.forEach((result, index) => {
      const format = textFormats[index]!;
      if (result.status === "rejected") {
        failedFormats.push(format);
        // 사용자 원문이 로그에 남지 않도록 오류 메시지만 남깁니다.
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.warn(`[youtube-blog] ${format} 생성 실패: ${reason.slice(0, 200)}`);
        return;
      }
      const generated = result.value;
      drafts[format] = generated.draft;
      inputTokens += generated.usage.inputTokens;
      outputTokens += generated.usage.outputTokens;
      costUsd += estimateCostUsd(generated.model, generated.usage);
      provider = provider || generated.provider;
      model = model || generated.model;
    });

    if (failedFormats.length === textFormats.length) {
      const first = settled.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
      throw first?.reason ?? new AppError("ai_failed", "초안을 만들지 못했습니다.", 502);
    }

    const successFormats = textFormats.filter((format) => !failedFormats.includes(format));
    const primaryFormat = successFormats[0]!;
    const durationMs = Date.now() - startedAt;

    const textPayload = {
      jobId: job.id,
      format: primaryFormat,
      formats: successFormats,
      failedFormats,
      source: sourcePayload,
      draft: drafts[primaryFormat] ?? null,
      drafts,
      video: null,
      credits: { remaining: consumed.balance, charged },
      meta: {
        provider,
        model,
        mode: runtime.aiMode,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
        textChars: source.text.length,
        textLanguage: source.language,
        textSource: resolved.meta.textSource,
        warnings: [
          ...resolved.warnings,
          ...(failedFormats.length > 0
            ? [`${failedFormats.join("·")} 형식은 만들지 못했습니다. 결과 탭에서 다시 시도할 수 있습니다.`]
            : []),
        ],
      },
    };

    await store.updateJob(job.id, {
      status: "succeeded",
      output: {
        format: primaryFormat,
        formats: successFormats,
        failedFormats,
        provider,
        sourceTitle: source.title,
        previews: successFormats.map((format) => draftTitle(drafts[format])),
        // 로그인 계정의 보관함(/api/jobs/{id})에서 다시 열 수 있도록 결과 원문을 남깁니다.
        result: textPayload,
      },
      provider,
      model,
      creditsCharged: charged,
      inputTokens,
      outputTokens,
      costUsd,
      durationMs,
      completedAt: new Date().toISOString(),
    });

    return NextResponse.json(textPayload);
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
      if (apiError.status >= 500) console.error("[youtube-blog] convert 실패", error);
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

/** 작업 기록에 남길 제목 한 줄(형식별 첫 제목). */
function draftTitle(draft: unknown): string | null {
  if (!draft || typeof draft !== "object") return null;
  const candidate = draft as { title?: unknown; hook?: unknown; headline?: unknown };
  const title = candidate.title ?? candidate.hook ?? candidate.headline;
  return typeof title === "string" ? title.slice(0, 200) : null;
}
