import { readFileSync } from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const desktopDir = path.resolve(__dirname, "..");

type BuilderConfig = {
  appId: string;
  productName: string;
  directories: { output: string; buildResources: string };
  files: string[];
  extraResources: { from: string; to: string }[];
  win: {
    executableName: string;
    icon: string;
    target: { target: string; arch: string[] }[];
  };
  nsis: { oneClick: boolean; artifactName: string; createDesktopShortcut: boolean };
  portable: { artifactName: string };
};

const config = yaml.load(readFileSync(path.join(desktopDir, "electron-builder.yml"), "utf8")) as BuilderConfig;
const pkg = JSON.parse(readFileSync(path.join(desktopDir, "package.json"), "utf8")) as {
  main: string;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("electron-builder 설정", () => {
  it("윈도우 NSIS 설치파일과 Portable 실행파일을 모두 만든다", () => {
    expect(config.win.target.map((target) => target.target)).toEqual(["nsis", "portable"]);
    expect(config.win.target.every((target) => target.arch.includes("x64"))).toBe(true);
    expect(config.nsis.artifactName).toBe("taest-Setup-${version}.${ext}");
    expect(config.portable.artifactName).toBe("taest-Portable-${version}.${ext}");
    expect(config.nsis.oneClick).toBe(false);
    expect(config.nsis.createDesktopShortcut).toBe(true);
  });

  it("앱 식별자·아이콘·산출 폴더가 지정돼 있다", () => {
    expect(config.appId).toBe("info.taest.desktop");
    expect(config.productName).toBe("taest");
    expect(config.directories.output).toBe("release");
    expect(config.win.icon).toBe("build/icon.png");
    expect(config.win.executableName).toBe("taest");
  });

  it("빌드 산출물(dist)과 설정 화면(renderer)을 패키지에 넣는다", () => {
    expect(config.files).toEqual(expect.arrayContaining(["dist/**/*", "renderer/**/*", "package.json"]));
    expect(config.extraResources).toEqual(expect.arrayContaining([{ from: "default-url.json", to: "default-url.json" }]));
  });

  it("패키지 진입점과 빌드 스크립트가 일치한다", () => {
    expect(pkg.main).toBe("dist/main.js");
    expect(pkg.scripts.build).toContain("tsc");
    expect(pkg.scripts["pack:win"]).toContain("electron-builder");
    expect(pkg.devDependencies.electron).toBeDefined();
    expect(pkg.devDependencies["electron-builder"]).toBeDefined();
  });
});

describe("연결/설정 화면", () => {
  const html = readFileSync(path.join(desktopDir, "renderer", "index.html"), "utf8");

  it("서버 주소 입력과 연결·테스트 동작이 있다", () => {
    expect(html).toContain('id="server-url"');
    expect(html).toContain('id="connect"');
    expect(html).toContain('id="test"');
    expect(html).toContain("api.connect");
    expect(html).toContain("api.testConnection");
    expect(html).toContain("api.reset");
  });

  it("한국어 안내와 오류 영역을 갖춘다", () => {
    expect(html).toContain("서버에 연결");
    expect(html).toContain("이 PC에만 저장");
    expect(html).toContain('id="banner"');
  });
});

describe("메인 프로세스", () => {
  const main = readFileSync(path.join(desktopDir, "src", "main.ts"), "utf8");

  it("환경변수·설정 파일을 모두 읽고 설정 화면으로 폴백한다", () => {
    expect(main).toContain("TAE_SAAS_WEB_URL");
    expect(main).toContain("showSetup");
    expect(main).toContain("did-fail-load");
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
  });
});
