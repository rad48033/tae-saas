import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import config from "../capacitor.config";
import url from "../www/url.js";

const appDir = path.resolve(__dirname, "..");
const { normalizeServerUrl } = url as { normalizeServerUrl: (input: string) => { ok: boolean; url?: string; error?: string } };

describe("Capacitor 설정", () => {
  it("앱 식별자와 웹 자산 폴더가 지정돼 있다", () => {
    expect(config.appId).toBe("info.taest.app");
    expect(config.appName).toBe("taest");
    expect(config.webDir).toBe("www");
    expect(config.server?.androidScheme).toBe("https");
  });

  it("연결 화면이 서버 주소를 저장하고 이동할 수 있게 되어 있다", () => {
    const html = readFileSync(path.join(appDir, "www", "index.html"), "utf8");
    expect(html).toContain('id="server-url"');
    expect(html).toContain('id="open"');
    expect(html).toContain("location.replace");
    expect(html).toContain('localStorage');
    expect(html).toContain("url.js");
    expect(html).toContain("default-config.js");
  });
});

describe("모바일 주소 검증", () => {
  it("스킴을 붙이고 끝 슬래시를 정리한다", () => {
    expect(normalizeServerUrl("taest.info/")).toEqual({ ok: true, url: "https://taest.info", origin: "https://taest.info" });
  });

  it("외부 http와 잘못된 입력을 막는다", () => {
    expect(normalizeServerUrl("http://taest.info").ok).toBe(false);
    expect(normalizeServerUrl("").ok).toBe(false);
    expect(normalizeServerUrl("ftp://taest.info").ok).toBe(false);
  });

  it("로컬 개발 주소는 허용한다", () => {
    expect(normalizeServerUrl("http://localhost:3000").ok).toBe(true);
  });
});
