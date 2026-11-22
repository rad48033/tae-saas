import type { ConversionJob } from "@tae/db";

import { VIDEO_PREVIEW_COST, VIDEO_RENDER_COST } from "./runtime";

/**
 * MP4 렌더는 응답(202) 뒤에 워커/인라인에서 계속 돌기 때문에, 크레딧은 렌더를 시작할 때
 * 차감하고 실패가 확인되는 순간(상태 조회) 자동으로 돌려줍니다. 그 연결고리를 작업 기록에
 * `kind: "video_render"` + `videoJobId`로 남깁니다.
 */
export const RENDER_JOB_KIND = "video_render";

export type RenderQuality = "preview" | "final";

export interface RenderChargeInput {
  videoJobId: string;
  quality: RenderQuality;
  title: string;
  aspectRatio: string;
}

export interface RenderCosts {
  final: number;
  preview: number;
}

export const DEFAULT_RENDER_COSTS: RenderCosts = {
  final: VIDEO_RENDER_COST,
  preview: VIDEO_PREVIEW_COST,
};

/** 렌더 품질별 차감 크레딧. final은 영상 총 크레딧에서 기획분을 뺀 값(기본 6). */
export function renderCost(quality: RenderQuality, costs: RenderCosts = DEFAULT_RENDER_COSTS): number {
  return quality === "preview" ? costs.preview : costs.final;
}

/** 크레딧 차감 기록에 남길 작업 입력 */
export function toRenderJobInput(input: RenderChargeInput): Record<string, unknown> {
  return { kind: RENDER_JOB_KIND, ...input };
}

export function isRenderJob(job: ConversionJob): boolean {
  return job.input?.kind === RENDER_JOB_KIND;
}

/** 기록에 저장된 렌더 작업 ID(작업 입력 또는 결과 어느 쪽에 있어도 찾습니다). */
export function renderVideoJobId(job: ConversionJob): string | null {
  const fromOutput = (job.output as { videoJobId?: unknown } | null)?.videoJobId;
  if (typeof fromOutput === "string" && fromOutput !== "pending") return fromOutput;
  const fromInput = (job.input as { videoJobId?: unknown }).videoJobId;
  return typeof fromInput === "string" && fromInput !== "pending" ? fromInput : null;
}

/** 같은 렌더 작업에 연결된, 아직 정산하지 않은 크레딧 기록을 찾습니다. */
export function findPendingRenderJob(jobs: ConversionJob[], videoJobId: string): ConversionJob | null {
  return jobs.find((job) => job.status === "running" && isRenderJob(job) && renderVideoJobId(job) === videoJobId) ?? null;
}
