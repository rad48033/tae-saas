import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const publicDir = path.resolve(__dirname, "..", "public");

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(publicDir, relativePath), "utf8")) as T;
}

function pngSize(relativePath: string): { width: number; height: number } {
  const buffer = readFileSync(path.join(publicDir, relativePath));
  // PNG 시그니처 확인 후 IHDR의 width/height를 읽습니다.
  expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

type Manifest = {
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

describe("PWA 매니페스트", () => {
  const manifest = readJson<Manifest>("manifest.webmanifest");

  it("한국어 앱 이름과 설명을 담는다", () => {
    expect(manifest.name).toContain("taest");
    expect(manifest.short_name).toBe("taest");
    expect(manifest.lang).toBe("ko");
    expect(manifest.description.length).toBeGreaterThan(30);
  });

  it("standalone 앱으로 설치된다", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url.startsWith("/")).toBe(true);
    expect(manifest.scope).toBe("/");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("192/512 및 maskable 아이콘을 선언하고 실제 파일이 맞는 크기다", () => {
    const declared = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose ?? "any"}`);
    expect(declared).toEqual(
      expect.arrayContaining(["192x192:any", "512x512:any", "192x192:maskable", "512x512:maskable"]),
    );

    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(icon.src.replace(/^\//, ""))).toEqual({ width, height });
    }
  });
});

describe("서비스 워커와 오프라인 셸", () => {
  it("오프라인 안내 페이지가 존재한다", () => {
    const html = readFileSync(path.join(publicDir, "offline.html"), "utf8");
    expect(html).toContain("인터넷 연결을 확인해 주세요");
    expect(statSync(path.join(publicDir, "offline.html")).size).toBeGreaterThan(500);
  });

  it("서비스 워커는 API를 캐시하지 않고 셸을 미리 담는다", () => {
    const sw = readFileSync(path.join(publicDir, "sw.js"), "utf8");
    expect(sw).toContain('"/offline.html"');
    expect(sw).toContain("request.mode === \"navigate\"");
    expect(sw).toContain('url.pathname.startsWith("/api/")');
    expect(sw).toContain("skipWaiting");
    expect(sw).not.toContain("cache.put(\"/api");
  });
});
