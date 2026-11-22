/**
 * 모바일 www 자산 준비 스크립트.
 *
 * - 필수 파일(index.html, url.js)이 있는지 확인합니다.
 * - TAE_SAAS_WEB_URL 환경변수가 있으면 www/default-config.js 에 기본 주소로 써 넣습니다.
 *   (GitHub Actions에서 workflow_dispatch 입력값을 앱에 박아 넣을 때 사용)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wwwDir = path.join(appDir, "www");
const REQUIRED = ["index.html", "error.html", "url.js", "default-config.js", "favicon.svg", "apple-touch-icon.png"];

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

for (const file of REQUIRED) {
  if (!existsSync(path.join(wwwDir, file))) fail(`www/${file} 가 없습니다. 앱 자산을 확인해 주세요.`);
}

const rawUrl = (process.env.TAE_SAAS_WEB_URL ?? "").trim();
let defaultUrl = "";

if (rawUrl) {
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    fail(`TAE_SAAS_WEB_URL 값이 주소 형식이 아닙니다: ${rawUrl}`);
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    fail("TAE_SAAS_WEB_URL 은 https:// 주소여야 합니다(로컬 개발은 http://localhost 허용).");
  }
  defaultUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

const configPath = path.join(wwwDir, "default-config.js");
const contents = `/* 이 파일은 scripts/prepare-www.mjs 가 생성합니다. 직접 고치지 마세요. */\nwindow.TAEST_DEFAULT_URL = ${JSON.stringify(defaultUrl)};\n`;
const previous = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
if (previous !== contents) writeFileSync(configPath, contents, "utf8");

const entry = readFileSync(path.join(wwwDir, "index.html"), "utf8");
if (!entry.includes("url.js")) fail("www/index.html 이 url.js 를 불러오지 않습니다.");

console.log(`✔ www 준비 완료 (기본 주소: ${defaultUrl || "설정 화면에서 입력"})`);
