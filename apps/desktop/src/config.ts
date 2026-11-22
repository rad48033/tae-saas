/**
 * 서버 주소 설정 저장소.
 *
 * 우선순위(앞이 이김):
 *  1. 사용자가 설정 화면에서 저장한 값  (<userData>/settings.json)
 *  2. TAE_SAAS_WEB_URL 환경변수
 *  3. 빌드에 포함된 기본값             (resources/default-url.json, 개발 시 apps/desktop/default-url.json)
 *  4. 실행 파일 옆 사이드카 파일       (tae-saas-url.txt)
 */
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

import { normalizeServerUrl, type UrlCheck } from "./url";

export type ServerUrlSource = "settings" | "env" | "bundled" | "sidecar";

export type ResolvedServerUrl = { url: string; source: ServerUrlSource };

export type SettingsFile = {
  serverUrl?: string;
  updatedAt?: string;
};

export const SETTINGS_FILENAME = "settings.json";

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readSettings(settingsDir: string): Promise<SettingsFile> {
  const parsed = await readJsonFile<SettingsFile>(path.join(settingsDir, SETTINGS_FILENAME));
  return parsed && typeof parsed === "object" ? parsed : {};
}

export async function saveSettings(settingsDir: string, serverUrl: string): Promise<SettingsFile> {
  const value = normalizeServerUrl(serverUrl);
  if (!value.ok) throw new Error(value.error);
  await mkdir(settingsDir, { recursive: true });
  const settings: SettingsFile = { serverUrl: value.url, updatedAt: new Date().toISOString() };
  await writeFile(path.join(settingsDir, SETTINGS_FILENAME), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

export async function clearSettings(settingsDir: string): Promise<void> {
  await rm(path.join(settingsDir, SETTINGS_FILENAME), { force: true });
}

/** 빌드에 포함된 기본 URL(default-url.json) 을 읽습니다. */
export async function readBundledServerUrl(bundledPath: string): Promise<string | null> {
  const parsed = await readJsonFile<{ webUrl?: string }>(bundledPath);
  return typeof parsed?.webUrl === "string" ? parsed.webUrl : null;
}

/** 실행 파일 옆 tae-saas-url.txt (첫 줄이 주소) 를 읽습니다. */
export async function readSidecarServerUrl(sidecarPath: string): Promise<string | null> {
  try {
    const raw = await readFile(sidecarPath, "utf8");
    const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
    return firstLine ?? null;
  } catch {
    return null;
  }
}

function firstValid(candidates: { value: string | null | undefined; source: ServerUrlSource }[]): ResolvedServerUrl | null {
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const checked: UrlCheck = normalizeServerUrl(candidate.value);
    if (checked.ok) return { url: checked.url, source: candidate.source };
  }
  return null;
}

/** 후보들을 우선순위대로 검사해 실제로 연결할 주소를 고릅니다(잘못된 값은 건너뜀). */
export function resolveServerUrl(candidates: {
  settings?: string | null;
  env?: string | null;
  bundled?: string | null;
  sidecar?: string | null;
}): ResolvedServerUrl | null {
  return firstValid([
    { value: candidates.settings, source: "settings" },
    { value: candidates.env, source: "env" },
    { value: candidates.bundled, source: "bundled" },
    { value: candidates.sidecar, source: "sidecar" },
  ]);
}
