import { NextResponse } from "next/server";

import { toApiError } from "@/lib/app-error";
import { ensureUser } from "@/lib/session";
import { getVideoJob } from "@/lib/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureUser();
    const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
    const job = await getVideoJob(jobId);
    if (!job) {
      return NextResponse.json(
        { error: { code: "not_found", message: "렌더 작업을 찾을 수 없습니다." } },
        { status: 404 },
      );
    }
    return NextResponse.json({ job });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: { code: apiError.code, message: apiError.message } }, { status: apiError.status });
  }
}
