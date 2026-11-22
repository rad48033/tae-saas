import type { ConversionJob } from "@tae/db";

/** 작업 기록을 화면·API에 내려줄 요약으로 바꿉니다(결과 원문 제외). */
export function summarizeJob(job: ConversionJob) {
  const input = job.input as { kind?: unknown; title?: unknown; formats?: unknown };
  const output = job.output as { sourceTitle?: unknown; result?: unknown } | null;
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
    hasResult: Boolean(output && typeof output === "object" && "result" in output),
    creditsCharged: job.creditsCharged,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

export type JobSummary = ReturnType<typeof summarizeJob>;
