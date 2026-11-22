import { NextResponse } from "next/server";

import { toApiError } from "@/lib/app-error";
import { getRuntime } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";
import { assertOwnedRenderJob } from "@/lib/ownership";
import { getVideoJob } from "@/lib/video";
import { findPendingRenderJob } from "@/lib/video-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 렌더 진행 상태. 본인 렌더 작업만 조회할 수 있고, 렌더가 끝났거나 실패했는데
 * 미정산 크레딧 기록이 남아 있으면 이 시점에 정산합니다(성공=차감 확정, 실패=자동 환불).
 */
export async function GET(request: Request) {
  try {
    const { user } = await ensureUser();
    const store = getRuntime().store;
    const jobId = new URL(request.url).searchParams.get("jobId") ?? "";

    // 소유권 확인: 내 변환 기록에 연결된 렌더 작업만 통과합니다.
    const owned = await assertOwnedRenderJob(store, user.id, jobId);

    const job = await getVideoJob(jobId);
    if (!job) {
      return NextResponse.json(
        { error: { code: "not_found", message: "렌더 작업을 찾을 수 없습니다." } },
        { status: 404 },
      );
    }

    let refunded = 0;
    if (job.status === "succeeded" || job.status === "failed") {
      const pending = findPendingRenderJob(await store.listJobs(user.id, 30), job.jobId);
      if (pending) {
        if (job.status === "failed" && pending.creditsCharged > 0) {
          refunded = pending.creditsCharged;
          try {
            await store.refundCredits({
              userId: user.id,
              amount: refunded,
              jobId: pending.id,
              description: "렌더 실패 크레딧 환불",
            });
          } catch {
            refunded = 0;
          }
          await store
            .updateJob(pending.id, {
              status: "failed",
              creditsCharged: 0,
              errorCode: "video_failed",
              errorMessage: job.error ?? "MP4를 만들지 못했습니다.",
              completedAt: new Date().toISOString(),
            })
            .catch(() => undefined);
        } else {
          await store
            .updateJob(pending.id, {
              status: "succeeded",
              creditsCharged: pending.creditsCharged,
              completedAt: new Date().toISOString(),
            })
            .catch(() => undefined);
        }
      } else if (owned && owned.status === "running") {
        // 렌더 기록과 실제 결과가 어긋난 경우에도 소유자 기록을 정리합니다.
        await store
          .updateJob(owned.id, {
            status: job.status,
            completedAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
    }

    const balance = await store.getBalance(user.id);
    return NextResponse.json({ job, credits: { remaining: balance.balance, refunded } });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
