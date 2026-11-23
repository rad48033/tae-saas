import { describe, expect, it } from "vitest";

import { mailStatus, resetMailBody, sendMail } from "../src/lib/mail";

describe("mailStatus", () => {
  it("reports 'not configured' when no provider key exists", () => {
    const status = mailStatus({});
    expect(status.configured).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.reason).toContain("RESEND_API_KEY");
  });

  it("uses RESEND_API_KEY with a configurable sender", () => {
    const status = mailStatus({ RESEND_API_KEY: "re_test", MAIL_FROM: "taest <no-reply@taest.info>" });
    expect(status.configured).toBe(true);
    expect(status.provider).toBe("resend");
    expect(status.from).toBe("taest <no-reply@taest.info>");
  });
});

describe("sendMail", () => {
  it("skips (does not fail) when the key is missing", async () => {
    const result = await sendMail({ to: "a@b.com", subject: "s", text: "t" }, { env: {} });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
  });

  it("posts the message to Resend when configured", async () => {
    const captured: { url?: string; body?: unknown; auth?: string | null } = {};
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      captured.url = String(input);
      captured.body = JSON.parse(String(init?.body));
      captured.auth = headers.get("authorization");
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    }) as typeof fetch;

    const result = await sendMail(
      { to: "member@example.com", subject: "[taest] 비밀번호 재설정 안내", text: "본문", html: "<p>본문</p>" },
      { env: { RESEND_API_KEY: "re_test", MAIL_FROM: "taest <no-reply@taest.info>" }, fetchImpl },
    );

    expect(result.ok).toBe(true);
    expect(captured?.url).toBe("https://api.resend.com/emails");
    expect(captured?.auth).toBe("Bearer re_test");
    expect(captured?.body).toMatchObject({
      from: "taest <no-reply@taest.info>",
      to: ["member@example.com"],
      subject: "[taest] 비밀번호 재설정 안내",
    });
  });

  it("returns the provider error instead of throwing", async () => {
    const fetchImpl = (async () => new Response("domain not verified", { status: 403 })) as typeof fetch;
    const result = await sendMail(
      { to: "member@example.com", subject: "s", text: "t" },
      { env: { RESEND_API_KEY: "re_test" }, fetchImpl },
    );
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toContain("403");
  });
});

describe("resetMailBody", () => {
  it("includes the one-time link, expiry and a personal line", () => {
    const body = resetMailBody({ link: "https://taest.info/reset-password?token=abc", displayName: "원균", expiresMinutes: 60 });
    expect(body.text).toContain("원균님");
    expect(body.text).toContain("https://taest.info/reset-password?token=abc");
    expect(body.text).toContain("60분");
    expect(body.text).toContain("본인이 요청하지 않았다면");
    expect(body.html).toContain('href="https://taest.info/reset-password?token=abc"');
  });

  it("escapes the display name", () => {
    const body = resetMailBody({ link: "https://x/y", displayName: '<img src=x onerror=alert(1)>', expiresMinutes: 60 });
    expect(body.html).not.toContain("<img src=x");
    expect(body.html).toContain("&lt;img");
  });
});
