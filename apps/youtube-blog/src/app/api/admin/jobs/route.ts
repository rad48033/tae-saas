import { NextResponse } from "next/server";

import { toApiError } from "@/lib/app-error";
import { requireAdmin } from "@/lib/auth/guard";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 최근 생성 작업 모니터링(관리자). */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
    const jobs = await getRuntime().store.listRecentJobs(limit);

    return NextResponse.json({
      jobs: jobs.map((job) => {
        const input = job.input as { kind?: unknown; title?: unknown; format?: unknown; formats?: unknown };
        const output = job.output as { format?: unknown; sourceTitle?: unknown } | null;
        const format =
          typeof output?.format === "string"
            ? output.format
            : Array.isArray(input.formats)
              ? (input.formats[0] as string)
              : typeof input.format === "string"
                ? input.format
                : null;
        return {
          id: job.id,
          userId: job.userId,
          userEmail: job.userEmail,
          userDisplayName: job.userDisplayName,
          status: job.status,
          format,
          title:
            typeof output?.sourceTitle === "string"
              ? output.sourceTitle
              : typeof input.title === "string"
                ? input.title
                : null,
          creditsCharged: job.creditsCharged,
          errorCode: job.errorCode,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        };
      }),
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
