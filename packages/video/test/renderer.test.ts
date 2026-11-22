import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildFfmpegPlan, detectFfmpeg } from "../src/renderer/ffmpeg";
import { runVideoPipeline } from "../src/pipeline";
import { buildDemoStoryboard } from "../src/demo/storyboard";
import { DemoImageProvider } from "../src/images/demo";
import { DemoTtsProvider } from "../src/audio/demo";
import type { RenderRequest } from "../src/types";
import type { SourceDocument } from "@tae/ai";

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "tae-video-render-"));
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const source: SourceDocument = {
  sourceType: "instagram",
  title: "쇼츠로 다시 쓰는 방법",
  author: "@content.daily",
  language: "ko",
  text: [
    "카드뉴스 열 장을 만들었다면 그중 한 장만 골라 쇼츠로 바꿔 보세요.",
    "첫 3초에 결론을 던지고, 45초 안에 이유를 하나만 붙입니다.",
    "자막은 소리 없이 봐도 이해되어야 합니다.",
    "같은 내용을 반복하지 말고, 결론과 근거의 순서를 바꾸세요.",
  ].join(" "),
};

function fakeRequest(): RenderRequest {
  const storyboard = buildDemoStoryboard(source, { aspectRatio: "9:16", language: "ko" });

  const scenes = storyboard.scenes.map((scene) => ({
    scene,
    imagePath: path.join(workDir, "images", `scene-${scene.index}.png`),
    audioPath: path.join(workDir, "audio", `scene-${scene.index}.wav`),
    audioDurationMs: scene.durationMs,
  }));

  return {
    storyboard,
    scenes,
    subtitlesPath: path.join(workDir, "subtitles.ass"),
    outPath: path.join(workDir, "video.mp4"),
    workDir,
    quality: "final",
  };
}

describe("ffmpeg plan", () => {
  it("builds a Ken Burns + concat + burned subtitle graph", () => {
    const request = fakeRequest();
    const plan = buildFfmpegPlan(request);

    expect(plan.args).toContain("-filter_complex");
    expect(plan.filter).toContain("zoompan");
    expect(plan.filter).toContain("concat=n=");
    expect(plan.filter).toContain("ass=filename=subtitles.ass");
    expect(plan.filter).toContain("aresample=48000");
    expect(plan.args).toContain("libx264");
    expect(plan.args).toContain("-movflags");
    expect(plan.width).toBe(1080);
    expect(plan.height).toBe(1920);
    expect(plan.totalSeconds).toBeCloseTo(request.storyboard.totalDurationMs / 1000, 1);
  });

  it("halves the resolution for preview renders", () => {
    const plan = buildFfmpegPlan({ ...fakeRequest(), quality: "preview" });
    expect(plan.width).toBe(540);
    expect(plan.height).toBe(960);
    expect(plan.args).toContain("ultrafast");
  });

  it("speeds up narration that is longer than the scene instead of cutting it", () => {
    const request = fakeRequest();
    const [first, ...rest] = request.scenes;
    expect(first).toBeDefined();
    const plan = buildFfmpegPlan({ ...request, scenes: [{ ...first!, tempo: 1.25 }, ...rest] });

    expect(plan.filter).toContain("atempo=1.250");
    // 배속을 쓰지 않는 장면에는 atempo가 붙지 않는다.
    expect(plan.filter.split("atempo").length - 1).toBe(1);
  });
});

describe("pipeline with demo providers", () => {
  it("produces images, audio, subtitles and a manifest without external APIs", async () => {
    const outputDir = path.join(workDir, "pipeline-9x16");
    const storyboard = buildDemoStoryboard(source, { aspectRatio: "9:16", language: "ko" });
    // 테스트 시간을 줄이기 위해 2장면만 사용합니다(실제 생성은 5~8장면).
    const twoScenes = {
      ...storyboard,
      scenes: storyboard.scenes.slice(0, 2).map((scene, index) => ({
        ...scene,
        index: index + 1,
        startMs: index * 6_000,
        endMs: (index + 1) * 6_000,
        durationMs: 6_000,
      })),
      totalDurationMs: 12_000,
    };

    const result = await runVideoPipeline({
      source,
      aspectRatio: "9:16",
      outputDir,
      storyboard: twoScenes,
      quality: "final",
      concurrency: 2,
      // 테스트는 네트워크(무료 이미지·TTS)에 기대지 않도록 결정적 제공자를 넣습니다.
      imageProvider: new DemoImageProvider(),
      ttsProvider: new DemoTtsProvider(),
    });

    expect(result.images).toHaveLength(2);
    expect(result.audio).toHaveLength(2);
    expect(result.subtitles.cues.length).toBeGreaterThan(0);
    expect(result.files.storyboard.endsWith("storyboard.json")).toBe(true);

    const srt = await readFile(result.files.srt, "utf8");
    expect(srt).toContain("-->");
    const ass = await readFile(result.files.ass, "utf8");
    expect(ass).toContain("PlayResY: 1920");

    const manifest = await readFile(path.join(outputDir, "manifest.json"), "utf8");
    expect(manifest).toContain("providers");

    const imageInfo = await stat(result.images[0]!.path);
    expect(imageInfo.size).toBeGreaterThan(10_000);

    // ffmpeg가 있으면 MP4, 없으면 자산만 + render.sh
    if (result.status === "succeeded") {
      const videoInfo = await stat(result.files.video!);
      expect(videoInfo.size).toBeGreaterThan(10_000);
    } else {
      expect(result.status).toBe("assets_only");
      expect(result.warnings.join(" ")).toContain("ffmpeg");
    }
  });
});

describe("ffmpeg detection", () => {
  it("returns null or a working binary, never throws", async () => {
    const info = await detectFfmpeg(process.env.FFMPEG_PATH);
    if (info) expect(info.path.length).toBeGreaterThan(0);
    else expect(info).toBeNull();
  });
});
