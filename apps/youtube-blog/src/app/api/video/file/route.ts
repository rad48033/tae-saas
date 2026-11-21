import { NextResponse } from "next/server";

import { toApiError } from "@/lib/app-error";
import { ensureUser } from "@/lib/session";
import { readVideoFile } from "@/lib/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FILE_NAMES: Record<string, string> = {
  "video.mp4": "tae-video.mp4",
  "subtitles.srt": "subtitles.srt",
  "subtitles.ass": "subtitles.ass",
  "storyboard.json": "storyboard.json",
};

/** 렌더 산출물 스트리밍. ?download=1이면 첨부 파일로 내려갑니다. */
export async function GET(request: Request) {
  try {
    await ensureUser();
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const name = url.searchParams.get("name") ?? "";

    const file = await readVideoFile(jobId, name);
    if (!file) {
      return NextResponse.json(
        { error: { code: "not_found", message: "파일을 찾을 수 없습니다." } },
        { status: 404 },
      );
    }

    const download = url.searchParams.get("download") === "1";
    const fileName = FILE_NAMES[name] ?? name;
    return new NextResponse(file.body, {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.size),
        "cache-control": "private, max-age=3600",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      },
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: { code: apiError.code, message: apiError.message } }, { status: apiError.status });
  }
}
