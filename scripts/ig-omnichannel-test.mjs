#!/usr/bin/env node
/**
 * 인스타그램 게시물 1건을 옴니채널(블로그 · 페이스북 · 유튜브 9:16/16:9 MP4)로 변환하는 테스트 드라이버.
 *
 *   node scripts/ig-omnichannel-test.mjs text
 *   node scripts/ig-omnichannel-test.mjs video 9:16
 *   node scripts/ig-omnichannel-test.mjs video 16:9
 *   node scripts/ig-omnichannel-test.mjs resume
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const OUT = process.env.OUT_DIR ?? "/workspace/downloads/tae-saas-ig-test";
const STATE = path.join(OUT, ".jobs.json");
const IG_URL = "https://www.instagram.com/p/Df_jIYWo6Io/";
const TITLE = "쁘띠앤 락토프리미엄, 온가족 장 건강 유산균 한 포";
const AUTHOR = "chan_ddangddang (정은ᰔᩚ(이찬맘))";

const mode = process.argv[2] ?? "text";
const aspect = process.argv[3] === "16:9" ? "16:9" : "9:16";

await mkdir(OUT, { recursive: true });

// ── 원문 (브라우저에서 추출한 캡션 + 사진 속 제품 문구) ──────────────────────
const sourceMd = await readFile(path.join(OUT, "source-caption.md"), "utf8");
const captionSection = sourceMd.split("## 캡션 (본문)")[1]?.split("## 사진·영상에서 보이는 문구")[0] ?? "";
// 인스타 입력은 앱이 읽는 캡션 그대로 넣습니다. 사진 속 제품 문구는 source-caption.md에만 정리해 둡니다.
const sourceText = captionSection.trim();

// ── 세션 쿠키 유지 ────────────────────────────────────────────────────────
const cookies = new Map();
try {
  const saved = JSON.parse(await readFile(STATE, "utf8"));
  for (const [key, value] of Object.entries(saved.cookies ?? {})) cookies.set(key, value);
} catch {
  // 첫 실행
}

function cookieHeader() {
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function call(pathname, body) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookies.size ? { cookie: cookieHeader() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const header of response.headers.getSetCookie?.() ?? []) {
    const [pair] = header.split(";");
    const [key, value] = (pair ?? "").split("=");
    if (key && value) cookies.set(key, value);
  }
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 파일 응답
  }
  return { status: response.status, json, text };
}

async function saveCookies(extra = {}) {
  let prev = {};
  try {
    prev = JSON.parse(await readFile(STATE, "utf8"));
  } catch {
    // 없음
  }
  await writeFile(STATE, `${JSON.stringify({ ...prev, ...extra, cookies: Object.fromEntries(cookies) }, null, 2)}\n`, "utf8");
}

function requireOk(result, label) {
  if (result.status !== 200 || !result.json) {
    throw new Error(`${label} 실패: HTTP ${result.status} ${result.text.slice(0, 400)}`);
  }
  return result.json;
}

function stripHash(tag) {
  return String(tag).replace(/^#/, "");
}

function blogMarkdown(draft) {
  return [
    "---",
    `title: "${draft.title.replace(/"/g, '\\"')}"`,
    `description: "${draft.metaDescription.replace(/"/g, '\\"')}"`,
    `tags: [${draft.tags.map((tag) => `"${tag}"`).join(", ")}]`,
    "---",
    "",
    `# ${draft.title}`,
    "",
    `> ${draft.metaDescription}`,
    "",
    draft.executiveSummary ? `> **한눈에 보는 요약** — ${draft.executiveSummary}` : "",
    "",
    draft.body,
    "",
    "## 핵심 요약",
    ...draft.keyTakeaways.map((item) => `- ${item}`),
    draft.faq.length ? "\n## 자주 묻는 질문" : "",
    ...draft.faq.map((item) => `\n### ${item.question}\n${item.answer}`),
  ]
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}

function facebookFeedText(draft) {
  return [
    draft.headline,
    draft.body,
    draft.bullets.map((bullet) => `• ${bullet}`).join("\n"),
    draft.closingQuestion,
    draft.hashtags.join(" "),
  ]
    .map((block) => String(block ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

// ── 텍스트 결과 ───────────────────────────────────────────────────────────
if (mode === "text") {
  const health = await call("/api/health");
  console.log("health:", health.status, JSON.stringify(health.json?.services));

  const blog = requireOk(
    await call("/api/convert", {
      sourceType: "instagram",
      url: IG_URL,
      text: sourceText,
      title: TITLE,
      author: AUTHOR,
      format: "blog",
      language: "ko",
    }),
    "블로그 변환",
  );
  await writeFile(path.join(OUT, "blog.md"), `${blogMarkdown(blog.draft)}\n`, "utf8");
  await writeFile(path.join(OUT, "blog.raw.json"), `${JSON.stringify(blog, null, 2)}\n`, "utf8");
  console.log(
    "blog:",
    `title=${blog.draft.title}`,
    `bodyChars=${blog.draft.body.length}`,
    `sections=${blog.draft.outline.length}`,
    `faq=${blog.draft.faq.length}`,
    `tags=${blog.draft.tags.length}`,
    `provider=${blog.meta.provider}`,
    `credits=${blog.credits.remaining}`,
  );

  const facebook = requireOk(
    await call("/api/convert", {
      sourceType: "instagram",
      url: IG_URL,
      text: sourceText,
      title: TITLE,
      author: AUTHOR,
      format: "facebook",
      language: "ko",
    }),
    "페이스북 변환",
  );
  const fbText = facebookFeedText(facebook.draft);
  await writeFile(path.join(OUT, "facebook.md"), `${fbText}\n`, "utf8");
  await writeFile(path.join(OUT, "facebook.raw.json"), `${JSON.stringify(facebook, null, 2)}\n`, "utf8");
  console.log(
    "facebook:",
    `lines=${fbText.split("\n").filter((line) => line.trim()).length}`,
    `bodyChars=${facebook.draft.body.length}`,
    `bullets=${facebook.draft.bullets.length}`,
    `hashtags=${facebook.draft.hashtags.length}`,
    `provider=${facebook.meta.provider}`,
    `credits=${facebook.credits.remaining}`,
  );

  await saveCookies({ textDone: new Date().toISOString() });
  console.log("\nOK");
}

// ── 영상 렌더 ─────────────────────────────────────────────────────────────
if (mode === "video") {
  const converted = requireOk(
    await call("/api/convert", {
      sourceType: "instagram",
      url: IG_URL,
      text: sourceText,
      title: TITLE,
      author: AUTHOR,
      format: "youtube_video",
      aspectRatio: aspect,
      language: "ko",
    }),
    `영상 기획(${aspect})`,
  );

  const tag = aspect === "16:9" ? "16x9" : "9x16";
  const { video, meta } = converted;
  await writeFile(path.join(OUT, `storyboard-${tag}.json`), `${JSON.stringify(video.storyboard, null, 2)}\n`, "utf8");
  await writeFile(path.join(OUT, `video-${tag}.srt`), video.subtitles.srt, "utf8");
  await writeFile(path.join(OUT, `video-${tag}.ass`), video.subtitles.ass, "utf8");
  await writeFile(path.join(OUT, `video-${tag}.convert.json`), `${JSON.stringify(converted, null, 2)}\n`, "utf8");

  console.log(
    "storyboard:",
    `${video.preset.label}`,
    `scenes=${video.storyboard.scenes.length}`,
    `seconds=${video.preset.totalSeconds}`,
    `cues=${video.subtitles.cueCount}`,
    `render=${video.render.mode}`,
    `model=${meta.model}`,
    `provider=${meta.provider}`,
  );

  if (!video.render.available) {
    console.log("render unavailable:", video.render.reason);
    process.exitCode = 2;
  } else {
    const started = await call("/api/video/render", { storyboard: video.storyboard, quality: "final" });
    if (started.status !== 202 || !started.json?.jobId) {
      throw new Error(`렌더 시작 실패: HTTP ${started.status} ${started.text.slice(0, 400)}`);
    }
    await saveCookies({ [tag]: { jobId: started.json.jobId, aspect } });
    console.log("render job:", started.json.jobId, started.json.mode);
  }
}

// ── 렌더 완료 대기·다운로드 ───────────────────────────────────────────────
if (mode === "resume" || mode === "video") {
  let state = JSON.parse(await readFile(STATE, "utf8"));
  const targets = mode === "resume" ? ["9x16", "16x9"].filter((tag) => state[tag]?.jobId) : [aspect === "16:9" ? "16x9" : "9x16"];

  for (const tag of targets) {
    const jobId = state[tag].jobId;
    let job = null;
    const deadline = Date.now() + Number(process.env.POLL_MS ?? 4 * 60 * 1000);
    while (Date.now() < deadline) {
      const status = await call(`/api/video/status?jobId=${jobId}`);
      job = status.json?.job ?? null;
      if (!job) throw new Error(`상태 조회 실패: HTTP ${status.status}`);
      process.stdout.write(`\r  ${tag} ${job.status} ${Math.round(job.progress * 100)}% ${job.stage}        `);
      if (job.status === "succeeded" || job.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    console.log("");

    if (!job || job.status !== "succeeded" || !job.files.mp4) {
      console.log(`${tag}: 아직 완료되지 않음 (${job?.status ?? "unknown"}) — resume로 이어서 확인`);
      continue;
    }

    for (const [key, name] of [
      ["mp4", `video-${tag}.mp4`],
      ["srt", `video-${tag}.srt`],
      ["ass", `video-${tag}.ass`],
      ["storyboard", `storyboard-${tag}.json`],
    ]) {
      if (!job.files[key]) continue;
      const response = await fetch(`${BASE}${job.files[key]}`, { headers: { cookie: cookieHeader() } });
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(path.join(OUT, name), buffer);
      console.log(`  saved ${name} ${(buffer.length / 1024).toFixed(0)}KB (http ${response.status})`);
    }
    await writeFile(path.join(OUT, `video-${tag}.job.json`), `${JSON.stringify(job, null, 2)}\n`, "utf8");
    console.log(
      `${tag}:`,
      `bytes=${job.video?.bytes}`,
      `duration=${job.video?.durationSeconds}s`,
      `renderer=${job.video?.renderer}`,
      `warnings=${job.warnings?.length ?? 0}`,
    );

    state = JSON.parse(await readFile(STATE, "utf8"));
    state[tag].done = true;
    await writeFile(STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
  console.log("\nOK");
}
