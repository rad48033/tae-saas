import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryStore } from "@tae/db";

import { findPendingRenderJob, renderCost, toRenderJobInput } from "../src/lib/video-credits";

const ENV_KEYS = ["TRIAL_CREDITS", "VIDEO_CONVERT_COST", "VIDEO_STORYBOARD_COST", "VIDEO_PREVIEW_COST"] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  clearEnv();
  vi.resetModules();
});

describe("v2 크레딧 단가", () => {
  it("체험 10크레딧, 영상 1편 9크레딧(기획 3 + 렌더 6)을 기본값으로 둔다", async () => {
    clearEnv();
    vi.resetModules();
    const runtime = await import("../src/lib/runtime");

    expect(runtime.TRIAL_CREDITS).toBe(10);
    expect(runtime.VIDEO_CONVERT_COST).toBe(9);
    expect(runtime.VIDEO_STORYBOARD_COST).toBe(3);
    expect(runtime.VIDEO_RENDER_COST).toBe(6);
    expect(runtime.VIDEO_STORYBOARD_COST + runtime.VIDEO_RENDER_COST).toBe(runtime.VIDEO_CONVERT_COST);
    expect(runtime.CONVERT_COST).toBe(1);
    expect(runtime.TEXT_SET_COST).toBe(1);
    expect(runtime.CREDIT_COSTS).toMatchObject({
      text: 1,
      textSet: 1,
      videoStoryboard: 3,
      videoRender: 6,
      videoTotal: 9,
      pdfPagesPerCredit: 10,
      trial: 10,
    });
  });

  it("환경변수로 영상 총액을 바꾸면 렌더 크레딧이 따라 바뀐다", async () => {
    clearEnv();
    process.env.VIDEO_CONVERT_COST = "12";
    process.env.VIDEO_STORYBOARD_COST = "4";
    vi.resetModules();
    const runtime = await import("../src/lib/runtime");

    expect(runtime.VIDEO_CONVERT_COST).toBe(12);
    expect(runtime.VIDEO_STORYBOARD_COST).toBe(4);
    expect(runtime.VIDEO_RENDER_COST).toBe(8);
  });

  it("렌더 품질별 차감액을 돌려준다", () => {
    expect(renderCost("final", { final: 6, preview: 1 })).toBe(6);
    expect(renderCost("preview", { final: 6, preview: 1 })).toBe(1);
  });
});

describe("렌더 크레딧 정산 연결", () => {
  it("videoJobId로 미정산 렌더 기록을 찾는다", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    const job = await store.createJob({
      userId: user.id,
      app: "youtube_blog",
      status: "running",
      input: toRenderJobInput({ videoJobId: "pending", quality: "final", title: "릴스", aspectRatio: "9:16" }),
    });
    await store.updateJob(job.id, { output: { videoJobId: "3f0c7d1e-1111-4222-8333-444455556666" }, creditsCharged: 6 });

    const jobs = await store.listJobs(user.id);
    const pending = findPendingRenderJob(jobs, "3f0c7d1e-1111-4222-8333-444455556666");
    expect(pending?.id).toBe(job.id);
    expect(pending?.creditsCharged).toBe(6);
    expect(findPendingRenderJob(jobs, "다른-작업")).toBeNull();
  });

  it("정산이 끝난(성공·실패) 기록은 다시 잡지 않는다", async () => {
    const store = new MemoryStore();
    const user = await store.createUser();
    const job = await store.createJob({
      userId: user.id,
      app: "youtube_blog",
      status: "running",
      input: toRenderJobInput({ videoJobId: "abc", quality: "final", title: "릴스", aspectRatio: "9:16" }),
    });
    await store.updateJob(job.id, { status: "succeeded", creditsCharged: 9 });

    expect(findPendingRenderJob(await store.listJobs(user.id), "abc")).toBeNull();
  });
});
