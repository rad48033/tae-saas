#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SourceDocument, SourceType } from "@tae/ai";

import { ASPECT_RATIOS, isAspectRatio, type AspectRatio, type VideoLanguage } from "./types";
import { generateStoryboard } from "./storyboard";
import { runVideoPipeline, summarizeResult } from "./pipeline";
import { doctor } from "./renderer/index";
import { createVideoProviders } from "./providers";
import { createVideoWorker } from "./worker";

/**
 * @tae/video CLI
 *
 *   tae-video doctor
 *   tae-video storyboard --source article.md --source-type blog --aspect 9:16
 *   tae-video render    --source article.md --source-type blog --aspect 16:9 --out .output/demo
 *   tae-video worker    --port 8080 --dir .output
 */
async function main(): Promise<void> {
  const [command = "help", ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (command) {
    case "doctor": {
      const info = await doctor(flags.ffmpeg);
      console.log(JSON.stringify(info, null, 2));
      return;
    }

    case "storyboard": {
      const source = await loadSource(flags);
      const aspect = parseAspect(flags.aspect);
      const language = parseLanguage(flags.language, source.language);
      const providers = createVideoProviders({ voice: flags.voice });
      const result = await generateStoryboard(source, {
        aspectRatio: aspect,
        language,
        ...(flags.voice ? { voice: flags.voice } : {}),
        ...(providers.storyboard ? { provider: providers.storyboard } : {}),
        ...(parseReferences(flags.ref ?? flags.reference).length > 0
          ? { referenceImages: parseReferences(flags.ref ?? flags.reference) }
          : {}),
      });

      if (flags.json) {
        console.log(JSON.stringify(result.storyboard, null, 2));
        return;
      }

      const storyboard = result.storyboard;
      console.log(`\n${storyboard.title} (${storyboard.aspectRatio}, ${storyboard.width}x${storyboard.height})`);
      console.log(`${storyboard.scenes.length}장면 · ${Math.round(storyboard.totalDurationMs / 1000)}초 · ${result.provider}/${result.model}`);
      for (const scene of storyboard.scenes) {
        console.log(`\n[${scene.index}] ${formatClock(scene.startMs)}–${formatClock(scene.endMs)} ${scene.title}`);
        console.log(`    ${scene.narration}`);
        console.log(`    visual: ${scene.visualPrompt.slice(0, 150)}…`);
      }
      console.log("");
      return;
    }

    case "render": {
      const source = await loadSource(flags);
      const aspect = parseAspect(flags.aspect);
      const out = flags.out ?? path.resolve(".output", `${aspect.replace(":", "x")}-${Date.now()}`);
      const quality = flags.quality === "preview" ? "preview" : "final";
      const language = parseLanguage(flags.language, source.language);
      const referenceInputs = parseReferences(flags.ref ?? flags.reference);

      const result = await runVideoPipeline({
        source,
        aspectRatio: aspect,
        outputDir: out,
        quality,
        language,
        ...(flags.voice ? { voice: flags.voice } : {}),
        ...(flags.concurrency ? { concurrency: Number(flags.concurrency) } : {}),
        ...(referenceInputs.length > 0 ? { referenceImages: referenceInputs } : {}),
        onProgress: (value, stage) => {
          if (!flags.json) process.stdout.write(`\r${String(Math.round(value * 100)).padStart(3)}% ${stage}        `);
        },
      });

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        process.stdout.write("\n");
        console.log(summarizeResult(result));
        console.log(`영상   : ${result.files.video ?? "(ffmpeg 없음 — 자산만 생성)"}`);
        console.log(`자막   : ${result.files.srt}`);
        console.log(`자막   : ${result.files.ass}`);
        console.log(`스토리보드: ${result.files.storyboard}`);
        console.log(`이미지 : ${result.images.length}장 · 음성 ${result.audio.length}개`);
        for (const warning of result.warnings) console.log(`경고   : ${warning}`);
      }

      if (result.status !== "succeeded") {
        process.exitCode = 2;
      }
      return;
    }

    case "worker": {
      const worker = await createVideoWorker({
        outputDir: flags.dir ?? path.resolve(".output"),
        ...(flags.port ? { port: Number(flags.port) } : {}),
        ...(flags.token ? { token: flags.token } : {}),
      });
      const { url } = await worker.listen();
      console.log(`video-worker listening on ${url}`);
      return;
    }

    default:
      console.log(
        [
          "사용법: tae-video <command> [options]",
          "",
          "  doctor                                    ffmpeg/제공자 상태",
          "  storyboard --source <file> --source-type blog|youtube|instagram --aspect 9:16|16:9",
          "  render     --source <file> --source-type blog --aspect 9:16 --out <dir> [--quality preview]",
          "             [--ref <제품사진 URL|경로>,<…>]   실제 제품 사진을 참조 이미지로 반영",
          "  worker     [--port 8080] [--dir .output]",
          "",
          `지원 비율: ${ASPECT_RATIOS.join(", ")}`,
        ].join("\n"),
      );
  }
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function parseAspect(value: string | undefined): AspectRatio {
  if (value && isAspectRatio(value)) return value;
  return "9:16";
}

function parseLanguage(value: string | undefined, fallback: string): VideoLanguage {
  if (value === "en" || value === "ko") return value;
  return fallback === "en" ? "en" : "ko";
}

/** --ref 값은 쉼표로 여러 장을 받습니다. URL이면 내려받고, 경로면 그대로 읽습니다. */
function parseReferences(value: string | undefined): import("./types").ReferenceImage[] {
  if (!value || value === "true") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => ({
      ...(/^https?:\/\//i.test(item) ? { url: item } : { path: item }),
      label: `참조 이미지 ${index + 1}`,
      role: "product" as const,
    }));
}

async function loadSource(flags: Record<string, string>): Promise<SourceDocument> {
  let text = flags.text ?? "";
  if (!text && flags.source) {
    text = flags.source === "-" ? await readStdin() : await readFile(flags.source, "utf8");
  }
  if (!text.trim()) {
    throw new Error("원문이 필요합니다. --source <file> 또는 --text \"...\"를 사용하세요.");
  }

  const sourceType = (flags["source-type"] as SourceType | undefined) ?? "blog";
  const title = flags.title?.trim() || firstLine(text) || "제목 없는 원문";
  const author = flags.author?.trim() || "CLI";

  return {
    sourceType,
    title,
    author,
    ...(flags.url ? { url: flags.url } : {}),
    id: `cli-${Date.now().toString(36)}`,
    text: text.trim(),
    language: flags.language === "en" ? "en" : "ko",
  };
}

function firstLine(text: string): string {
  const first = text
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .find((line) => line.length > 0);
  return first?.slice(0, 100) ?? "";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
