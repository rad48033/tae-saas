import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildDemoStoryboard } from "../src/demo/storyboard";
import { createVideoWorker, type VideoWorker } from "../src/worker";
import type { Storyboard } from "../src/types";
import type { SourceDocument } from "@tae/ai";

const source: SourceDocument = {
  sourceType: "blog",
  title: "워커 테스트",
  author: "테스트",
  language: "ko",
  text: "첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장입니다. 다섯 번째 문장입니다.",
};

let worker: VideoWorker;
let baseUrl = "";
let workDir = "";

function tinyStoryboard(): Storyboard {
  const storyboard = buildDemoStoryboard(source, { aspectRatio: "9:16", language: "ko" });
  return {
    ...storyboard,
    scenes: storyboard.scenes.slice(0, 1).map((scene) => ({
      ...scene,
      startMs: 0,
      endMs: 4_000,
      durationMs: 4_000,
    })),
    totalDurationMs: 4_000,
  };
}

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "tae-video-worker-"));
  worker = await createVideoWorker({ outputDir: workDir, token: "test-token", port: 0, concurrentJobs: 1 });
  const listening = await worker.listen();
  baseUrl = listening.url;
});

afterAll(async () => {
  await worker.close();
  const { rm } = await import("node:fs/promises");
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("video worker", () => {
  it("reports health without auth", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; providers: Record<string, string> };
    expect(body.status).toBe("ok");
    expect(body.providers.tts).toBeTruthy();
  });

  it("rejects requests without the worker token", async () => {
    const response = await fetch(`${baseUrl}/v1/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storyboard: tinyStoryboard() }),
    });
    expect(response.status).toBe(401);
  });

  it("validates the storyboard payload", async () => {
    const response = await fetch(`${baseUrl}/v1/render`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token" },
      body: JSON.stringify({ storyboard: { version: 1 } }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_storyboard");
  });

  it("accepts a render job and exposes its status and files", async () => {
    const response = await fetch(`${baseUrl}/v1/render`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token" },
      body: JSON.stringify({ storyboard: tinyStoryboard(), quality: "preview" }),
    });
    expect(response.status).toBe(202);
    const created = (await response.json()) as { job: { id: string } };
    const jobId = created.job.id;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    let status = "queued";
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const poll = await fetch(`${baseUrl}/v1/jobs/${jobId}`, { headers: { authorization: "Bearer test-token" } });
      const body = (await poll.json()) as { job: { status: string; progress: number } };
      status = body.job.status;
      if (status === "succeeded" || status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // ffmpeg가 없으면 자산만 남기고 실패로 표시합니다(설정 오류를 숨기지 않음).
    expect(["succeeded", "failed"]).toContain(status);

    const srt = await fetch(`${baseUrl}/v1/jobs/${jobId}/files/subtitles.srt`, {
      headers: { authorization: "Bearer test-token" },
    });
    expect(srt.status).toBe(200);
    expect(await srt.text()).toContain("-->");
  });

  it("blocks path traversal on the file endpoint", async () => {
    const response = await fetch(`${baseUrl}/v1/jobs/00000000-0000-0000-0000-000000000000/files/..%2F..%2Fetc%2Fpasswd`, {
      headers: { authorization: "Bearer test-token" },
    });
    expect([403, 404]).toContain(response.status);
  });
});
