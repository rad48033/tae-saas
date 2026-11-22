import { describe, expect, it } from "vitest";

import { displayHost, isSameOrigin, normalizeServerUrl } from "../src/url";

describe("normalizeServerUrl", () => {
  it("스킴이 없으면 https를 붙인다", () => {
    const result = normalizeServerUrl("taest.info");
    expect(result).toEqual({ ok: true, url: "https://taest.info", origin: "https://taest.info" });
  });

  it("끝 슬래시와 쿼리·해시를 떼고 경로는 남긴다", () => {
    const result = normalizeServerUrl("https://taest.info/app/?utm=1#pricing");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://taest.info/app");
  });

  it("로컬 개발 주소는 http를 허용한다", () => {
    expect(normalizeServerUrl("http://localhost:3000").ok).toBe(true);
    expect(normalizeServerUrl("http://127.0.0.1:3000").ok).toBe(true);
  });

  it("외부 서버의 http는 거부한다", () => {
    const result = normalizeServerUrl("http://taest.info");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("https");
  });

  it("빈 값·공백·자격증명·다른 스킴을 거부한다", () => {
    expect(normalizeServerUrl("").ok).toBe(false);
    expect(normalizeServerUrl("   ").ok).toBe(false);
    expect(normalizeServerUrl("https://user:pass@taest.info").ok).toBe(false);
    expect(normalizeServerUrl("ftp://taest.info").ok).toBe(false);
    expect(normalizeServerUrl("https://taest.info/a b").ok).toBe(false);
  });

  it("주소로 해석되지 않는 값은 오류 메시지를 준다", () => {
    const result = normalizeServerUrl("https://");
    expect(result.ok).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("같은 사이트만 참으로 본다", () => {
    expect(isSameOrigin("https://taest.info/a", "https://taest.info/b")).toBe(true);
    expect(isSameOrigin("https://taest.info", "https://evil.example")).toBe(false);
    expect(isSameOrigin("http://localhost:3000", "http://localhost:3001")).toBe(false);
  });
});

describe("displayHost", () => {
  it("www를 떼고 포트를 유지한다", () => {
    expect(displayHost("https://www.taest.info")).toBe("taest.info");
    expect(displayHost("http://localhost:3000")).toBe("localhost:3000");
  });
});
