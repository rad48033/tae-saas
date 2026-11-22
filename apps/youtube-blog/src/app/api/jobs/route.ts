import { NextResponse } from "next/server";

import { toApiError } from "@/lib/app-error";
import { summarizeJob } from "@/lib/job-view";
import { getRuntime } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 로그인한 계정의 작업(보관함) 목록. 항상 세션 사용자 기준으로만 조회합니다.
 * 결과 원문은 /api/jobs/{id}에서 소유권을 다시 확인한 뒤 내려줍니다.
 */
export async function GET(request: Request) {
  try {
    const { user } = await ensureUser();
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 30)));
    const jobs = await getRuntime().store.listJobs(user.id, limit);

    return NextResponse.json({
      jobs: jobs.map(summarizeJob),
      viewer: { id: user.id, isGuest: user.signupProvider === "guest" },
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
