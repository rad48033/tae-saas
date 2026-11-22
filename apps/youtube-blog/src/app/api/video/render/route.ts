import { NextResponse } from "next/server";
import { z } from "zod";

import { storyboardSchema, type Storyboard } from "@tae/video";

import { AppError, toApiError } from "@/lib/app-error";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRuntime } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";
import { startVideoRender } from "@/lib/video";
import { renderCost, toRenderJobInput } from "@/lib/video-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  storyboard: storyboardSchema,
  quality: z.enum(["preview", "final"]).default("final"),
});

/**
 * 스토리보드를 받아 MP4 렌더 작업을 시작합니다.
 * 워커(VIDEO_WORKER_URL)가 있으면 워커 큐에, 없으면 로컬 인라인 모드로 실행합니다.
 * 렌더는 실제 원가(장면 이미지·음성)가 들기 때문에 시작할 때 크레딧을 차감하고,
 * 실패가 확인되면(/api/video/status) 자동으로 환불합니다.
 */
export async function POST(request: Request) {
  const { store } = getRuntime();
  let chargeJobId: string | null = null;
  let charged = 0;

  try {
    const { user } = await ensureUser();
    enforceRateLimit(`video-render:${user.id}`, { limit: 10, windowMs: 60 * 60 * 1000 });

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "스토리보드 형식이 올바르지 않습니다.", 400, parsed.error.issues.slice(0, 8));
    }

    const storyboard = parsed.data.storyboard as Storyboard;
    const quality = parsed.data.quality;
    const cost = renderCost(quality);

    const balance = await store.getBalance(user.id);
    if (balance.balance < cost) {
      throw new AppError(
        "insufficient_credits",
        quality === "preview"
          ? `미리보기 렌더에는 ${cost}크레딧이 필요합니다. 크레딧 탭에서 충전해 주세요.`
          : `MP4 렌더에는 ${cost}크레딧이 필요합니다. 크레딧 탭에서 충전해 주세요.`,
        402,
        { requiredCredits: cost, balance: balance.balance },
      );
    }

    const chargeJob = await store.createJob({
      userId: user.id,
      app: "youtube_blog",
      status: "running",
      input: toRenderJobInput({
        videoJobId: "pending",
        quality,
        title: storyboard.title,
        aspectRatio: storyboard.aspectRatio,
      }),
    });
    chargeJobId = chargeJob.id;

    let remaining = balance.balance;
    if (cost > 0) {
      const consumed = await store.consumeCredits({
        userId: user.id,
        amount: cost,
        jobId: chargeJob.id,
        description: `${quality === "preview" ? "미리보기" : "MP4"} 렌더 · ${storyboard.aspectRatio} · ${storyboard.title.slice(0, 40)}`,
      });
      if (!consumed.ok) {
        throw new AppError("insufficient_credits", "크레딧이 부족합니다.", 402, {
          requiredCredits: cost,
          balance: consumed.balance,
        });
      }
      remaining = consumed.balance;
      charged = cost;
    }

    const started = await startVideoRender(storyboard, { quality });

    await store.updateJob(chargeJob.id, {
      output: { videoJobId: started.jobId, mode: started.mode, quality },
      creditsCharged: charged,
    });

    return NextResponse.json({ ...started, credits: { remaining, charged } }, { status: 202 });
  } catch (error) {
    if (chargeJobId) {
      if (charged > 0) {
        try {
          const userId = (await store.getJob(chargeJobId))?.userId;
          if (userId) await store.refundCredits({ userId, amount: charged, jobId: chargeJobId });
        } catch {
          // 환불 실패는 원래 오류를 가리지 않습니다.
        }
      }
      await store
        .updateJob(chargeJobId, {
          status: "failed",
          creditsCharged: 0,
          completedAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }

    const apiError = toApiError(error);
    return NextResponse.json(
      { error: { code: apiError.code, message: apiError.message } },
      { status: apiError.status },
    );
  }
}
