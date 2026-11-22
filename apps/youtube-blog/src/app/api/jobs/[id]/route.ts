import { NextResponse } from "next/server";

import { toApiError } from "@/lib/app-error";
import { summarizeJob } from "@/lib/job-view";
import { getOwnedJob } from "@/lib/ownership";
import { getRuntime } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 작업 상세(보관함에서 다시 열기). 다른 사람의 작업은 404로 숨깁니다. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await ensureUser();
    const { id } = await context.params;
    const job = await getOwnedJob(getRuntime().store, user.id, id);
    const output = (job.output ?? null) as { result?: unknown } | null;

    return NextResponse.json({
      job: summarizeJob(job),
      /** 저장된 결과 원문(없으면 null) */
      result: output && typeof output === "object" && "result" in output ? output.result : null,
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
