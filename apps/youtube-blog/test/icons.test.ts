import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(appDir, "..", "..");

function pngSize(file: string): { width: number; height: number } {
  const buffer = readFileSync(file);
  expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("앱 아이콘 (1번 아이콘 반영)", () => {
  it("원본 아이콘을 저장소에 두고 있다", () => {
    const master = path.join(repoDir, "assets", "brand", "taest-icon.png");
    expect(existsSync(master)).toBe(true);
    expect(statSync(master).size).toBeGreaterThan(100_000);
  });

  it("PWA 아이콘 크기가 매니페스트와 맞는다", () => {
    expect(pngSize(path.join(appDir, "public", "icons", "icon-192.png"))).toEqual({ width: 192, height: 192 });
    expect(pngSize(path.join(appDir, "public", "icons", "icon-512.png"))).toEqual({ width: 512, height: 512 });
    expect(pngSize(path.join(appDir, "public", "icons", "icon-maskable-192.png"))).toEqual({ width: 192, height: 192 });
    expect(pngSize(path.join(appDir, "public", "icons", "icon-maskable-512.png"))).toEqual({ width: 512, height: 512 });
    expect(pngSize(path.join(appDir, "public", "icons", "apple-touch-icon.png"))).toEqual({ width: 180, height: 180 });
    expect(pngSize(path.join(appDir, "src", "app", "icon.png"))).toEqual({ width: 256, height: 256 });
  });

  it("파비콘 ico·svg가 있다", () => {
    const ico = path.join(appDir, "public", "favicon.ico");
    expect(existsSync(ico)).toBe(true);
    expect(readFileSync(ico).subarray(0, 4).toString("hex")).toBe("00000100");
    const svg = readFileSync(path.join(appDir, "public", "favicon.svg"), "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("aria-label=\"taest\"");
  });

  it("데스크톱(Electron) 아이콘 png·ico가 있다", () => {
    expect(pngSize(path.join(repoDir, "apps", "desktop", "build", "icon.png"))).toEqual({ width: 512, height: 512 });
    expect(existsSync(path.join(repoDir, "apps", "desktop", "build", "icon.ico"))).toBe(true);
  });

  it("안드로이드 런처 아이콘 밀도별 크기가 맞는다", () => {
    const res = path.join(repoDir, "apps", "mobile", "android", "app", "src", "main", "res");
    const densities: Record<string, { launcher: number; adaptive: number }> = {
      ldpi: { launcher: 36, adaptive: 81 },
      mdpi: { launcher: 48, adaptive: 108 },
      hdpi: { launcher: 72, adaptive: 162 },
      xhdpi: { launcher: 96, adaptive: 216 },
      xxhdpi: { launcher: 144, adaptive: 324 },
      xxxhdpi: { launcher: 192, adaptive: 432 },
    };

    for (const [density, size] of Object.entries(densities)) {
      const folder = path.join(res, `mipmap-${density}`);
      expect(pngSize(path.join(folder, "ic_launcher.png"))).toEqual({ width: size.launcher, height: size.launcher });
      expect(pngSize(path.join(folder, "ic_launcher_round.png"))).toEqual({ width: size.launcher, height: size.launcher });
      expect(pngSize(path.join(folder, "ic_launcher_foreground.png"))).toEqual({ width: size.adaptive, height: size.adaptive });
    }
  });
});
