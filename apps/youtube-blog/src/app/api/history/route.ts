import { NextResponse } from "next/server";

import { toApiError } from "@/lib/app-error";
import { getRuntime } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 이 계정의 최근 작업 기록(서버 기준). 브라우저를 바꿔도 남는 요약이라
 * 보관함 탭에서 "이 기기에 저장된 결과"와 함께 보여 줍니다.
 */
export async function GET(request: Request) {
  try {
    const { user } = await ensureUser();
    const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 20)));
    const jobs = await getRuntime().store.listJobs(user.id, limit);

    return NextResponse.json({
      jobs: jobs.map((job) => {
        const input = job.input as { kind?: unknown; title?: unknown; formats?: unknown };
        const output = job.output as { sourceTitle?: unknown } | null;
        const isRender = input?.kind === "video_render";
        const formats = Array.isArray(input?.formats)
          ? (input.formats as string[])
          : isRender
            ? ["youtube_video"]
            : null;

        return {
          id: job.id,
          app: job.app,
          status: job.status,
          title:
            typeof output?.sourceTitle === "string"
              ? output.sourceTitle
              : typeof input?.title === "string"
                ? input.title
                : null,
          formats,
          render: isRender,
          output: job.output,
          creditsCharged: job.creditsCharged,
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        };
      }),
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: { code: apiError.code, message: apiError.message } }, { status: apiError.status });
  }
}
