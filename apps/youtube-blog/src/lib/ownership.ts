import type { ConversionJob, Store } from "@tae/db";

import { AppError } from "./app-error";
import { renderVideoJobId } from "./video-credits";

/**
 * 영상 렌더 작업 ID가 정말 이 사용자의 것인지 확인합니다.
 * 워커/파일 저장소는 작업 ID만 알면 접근할 수 있으므로, 변환 작업 기록에
 * 연결된 user_id가 일치할 때만 통과시킵니다.
 */
export async function findOwnedRenderJob(
  store: Store,
  userId: string,
  videoJobId: string,
): Promise<ConversionJob | null> {
  if (!videoJobId || videoJobId.length > 200) return null;
  const jobs = await store.listJobs(userId, 200);
  return jobs.find((job) => renderVideoJobId(job) === videoJobId) ?? null;
}

export async function assertOwnedRenderJob(store: Store, userId: string, videoJobId: string): Promise<ConversionJob> {
  const job = await findOwnedRenderJob(store, userId, videoJobId);
  if (!job) {
    // 남의 작업 존재 여부도 알려 주지 않도록 404로 통일합니다.
    throw new AppError("not_found", "렌더 작업을 찾을 수 없습니다.", 404);
  }
  return job;
}

/** 변환 작업(job_id)을 소유자에게만 돌려줍니다. */
export async function getOwnedJob(store: Store, userId: string, jobId: string): Promise<ConversionJob> {
  const job = await store.getJob(jobId);
  if (!job || job.userId !== userId) {
    throw new AppError("not_found", "작업을 찾을 수 없습니다.", 404);
  }
  return job;
}
