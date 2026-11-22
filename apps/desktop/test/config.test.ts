import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearSettings,
  readBundledServerUrl,
  readSettings,
  readSidecarServerUrl,
  resolveServerUrl,
  saveSettings,
} from "../src/config";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "taest-desktop-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("설정 파일", () => {
  it("저장한 주소를 다시 읽고 지울 수 있다", async () => {
    await saveSettings(tempDir, "taest.info/");
    const settings = await readSettings(tempDir);
    expect(settings.serverUrl).toBe("https://taest.info");
    expect(typeof settings.updatedAt).toBe("string");

    await clearSettings(tempDir);
    expect(await readSettings(tempDir)).toEqual({});
  });

  it("잘못된 주소는 저장하지 않는다", async () => {
    await expect(saveSettings(tempDir, "http://taest.info")).rejects.toThrow(/https/);
    expect(await readSettings(tempDir)).toEqual({});
  });

  it("설정 파일이 깨져 있어도 빈 설정으로 시작한다", async () => {
    await writeFile(path.join(tempDir, "settings.json"), "{not json", "utf8");
    expect(await readSettings(tempDir)).toEqual({});
  });
});

describe("기본값 파일", () => {
  it("빌드 기본 URL과 사이드카 파일을 읽는다", async () => {
    await writeFile(path.join(tempDir, "default-url.json"), JSON.stringify({ webUrl: "https://taest.info" }), "utf8");
    await writeFile(path.join(tempDir, "tae-saas-url.txt"), "\n  https://staging.taest.info  \n", "utf8");

    expect(await readBundledServerUrl(path.join(tempDir, "default-url.json"))).toBe("https://taest.info");
    expect(await readSidecarServerUrl(path.join(tempDir, "tae-saas-url.txt"))).toBe("https://staging.taest.info");
    expect(await readBundledServerUrl(path.join(tempDir, "missing.json"))).toBeNull();
    expect(await readSidecarServerUrl(path.join(tempDir, "missing.txt"))).toBeNull();
  });
});

describe("resolveServerUrl 우선순위", () => {
  it("사용자 설정 > 환경변수 > 빌드 기본값 > 사이드카 순서", () => {
    expect(
      resolveServerUrl({
        settings: "https://saved.taest.info",
        env: "https://env.taest.info",
        bundled: "https://bundled.taest.info",
        sidecar: "https://sidecar.taest.info",
      }),
    ).toEqual({ url: "https://saved.taest.info", source: "settings" });

    expect(
      resolveServerUrl({ env: "https://env.taest.info", bundled: "https://bundled.taest.info" }),
    ).toEqual({ url: "https://env.taest.info", source: "env" });

    expect(resolveServerUrl({ bundled: "https://bundled.taest.info", sidecar: "https://sidecar.taest.info" })).toEqual({
      url: "https://bundled.taest.info",
      source: "bundled",
    });

    expect(resolveServerUrl({ sidecar: "https://sidecar.taest.info" })).toEqual({
      url: "https://sidecar.taest.info",
      source: "sidecar",
    });
  });

  it("잘못된 후보는 건너뛰고 다음 후보를 쓴다", () => {
    expect(resolveServerUrl({ settings: "not a url", env: "https://env.taest.info" })).toEqual({
      url: "https://env.taest.info",
      source: "env",
    });
  });

  it("후보가 없으면 null", () => {
    expect(resolveServerUrl({})).toBeNull();
    expect(resolveServerUrl({ settings: "", env: null, bundled: "" })).toBeNull();
  });
});
