import { NextResponse } from "next/server";
import { z } from "zod";

import { estimateCostUsd, type Transcript } from "@tae/ai";

import { AppError, toApiError } from "@/lib/app-error";
import { enforceRateLimit } from "@/lib/rate-limit";
import { CONVERT_COST, getRuntime } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";
import {
  MAX_TRANSCRIPT_INPUT_CHARS,
  MIN_TRANSCRIPT_CHARS,
  transcriptFromText,
} from "@/lib/transcript";
import { fetchTranscript, fetchVideoMeta, parseVideoId, VideoError } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  url: z.string().min(5).max(500),
  format: z.enum(["blog", "instagram", "facebook"]).default("blog"),
  language: z.enum(["ko", "en"]).default("ko"),
  focusKeyword: z.string().max(80).optional(),
  audience: z.string().max(120).optional(),
  /** 자동 추출이 막힌 경우 사용자가 붙여넣은 자막 */
  transcript: z.string().min(MIN_TRANSCRIPT_CHARS).max(MAX_TRANSCRIPT_INPUT_CHARS).optional(),
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

    const videoId = parseVideoId(body.url);
    if (!videoId) {
      throw new AppError("invalid_url", "유튜브 링크를 확인해 주세요. 예: https://www.youtube.com/watch?v=…", 400);
    }

    const balance = await store.getBalance(user.id);
    if (balance.balance < CONVERT_COST) {
      throw new AppError(
        "insufficient_credits",
        "크레딧이 부족합니다. 아래 요금제에서 크레딧을 충전해 주세요.",
        402,
        { requiredCredits: CONVERT_COST, balance: balance.balance },
      );
    }

    const job = await store.createJob({
      userId: user.id,
      app: "youtube_blog",
      status: "running",
      input: {
        videoId,
        format: body.format,
        language: body.language,
        transcriptSource: body.transcript ? "manual" : "auto",
      },
    });
    jobId = job.id;

    const consumed = await store.consumeCredits({
      userId: user.id,
      amount: CONVERT_COST,
      jobId: job.id,
      description: `유튜브 ${body.format} 변환`,
    });
    if (!consumed.ok) {
      throw new AppError("insufficient_credits", "크레딧이 부족합니다.", 402, {
        requiredCredits: CONVERT_COST,
        balance: consumed.balance,
      });
    }
    charged = CONVERT_COST;

    const startedAt = Date.now();
    const video = await fetchVideoMeta(videoId);

    let transcript: Transcript;
    let transcriptSource: "manual" | "auto" = "manual";
    if (body.transcript) {
      transcript = transcriptFromText(body.transcript, body.language);
    } else {
      transcriptSource = "auto";
      transcript = await fetchTranscript(videoId).catch((error: unknown) => {
        if (error instanceof VideoError && error.code === "transcript_unavailable") {
          throw new AppError(
            "transcript_unavailable",
            "이 영상의 자막을 자동으로 가져오지 못했습니다(유튜브 자동 추출 제한). 유튜브에서 '스크립트 표시'를 열어 복사한 뒤, 고급 옵션의 '자막 직접 붙여넣기'에 넣으면 바로 만들 수 있습니다.",
            422,
          );
        }
        throw error;
      });
    }

    if (transcript.text.trim().length < 60) {
      throw new AppError(
        "transcript_unavailable",
        "자막이 너무 짧아 글로 만들 수 없습니다. 내용이 있는 영상이나 더 긴 자막으로 시도해 주세요.",
        422,
      );
    }

    const result = await ai.generateContent({
      video,
      transcript,
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
      output: { format: result.draft.format, provider: result.provider, videoTitle: video.title },
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
      draft: result.draft,
      video: {
        id: video.id,
        url: video.url,
        title: video.title,
        channelTitle: video.channelTitle,
        durationSeconds: video.durationSeconds ?? null,
        thumbnailUrl: video.thumbnailUrl ?? null,
      },
      credits: { remaining: consumed.balance, charged },
      meta: {
        provider: result.provider,
        model: result.model,
        mode: runtime.aiMode,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd,
        durationMs,
        transcriptChars: transcript.text.length,
        transcriptLanguage: transcript.language,
        transcriptSource,
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

      return NextResponse.json({ error: { code: apiError.code, message: apiError.message } }, { status: apiError.status });
    }

    const apiError = toApiError(error);
    if (apiError.status >= 500) console.error("[youtube-blog] convert 실패", error);
    return NextResponse.json(
      { error: { code: apiError.code, message: apiError.message, details: apiError.details ?? null } },
      { status: apiError.status },
    );
  }
}
