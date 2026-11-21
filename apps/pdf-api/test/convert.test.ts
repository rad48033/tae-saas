import { describe, expect, it } from "vitest";

import { creditsForPages, cleanPageText, extractPdf } from "../src/lib/pdf";
import { assertPublicHttpUrl, normalizeOptions } from "../src/lib/parse-request";
import { authHeaders, fakeAi, pdfForm, readFixture, setup } from "./helpers";

describe("pdf extraction", () => {
  it("extracts text page by page", async () => {
    const pdf = await extractPdf(await readFixture("invoice.pdf"));
    expect(pdf.pageCount).toBe(3);
    expect(pdf.pages[0]?.text).toContain("INVOICE");
    expect(pdf.pages[0]?.text).toContain("1,362.90");
    expect(pdf.pages[1]?.text).toContain("Kookmin");
    expect(pdf.characterCount).toBeGreaterThan(100);
  });

  it("returns empty text for a blank page", async () => {
    const pdf = await extractPdf(await readFixture("blank.pdf"));
    expect(pdf.pageCount).toBe(1);
    expect(pdf.characterCount).toBe(0);
  });

  it("charges one credit per ten pages", () => {
    expect(creditsForPages(1)).toBe(1);
    expect(creditsForPages(10)).toBe(1);
    expect(creditsForPages(11)).toBe(2);
    expect(creditsForPages(200)).toBe(20);
  });

  it("cleans repeated whitespace but keeps line structure", () => {
    expect(cleanPageText("a   b\n\n\n\nc")).toBe("a b\n\nc");
  });
});

describe("request validation", () => {
  it("blocks private and loopback URLs", () => {
    expect(assertPublicHttpUrl("https://example.com/a.pdf").hostname).toBe("example.com");
    for (const url of [
      "http://localhost:3000/a.pdf",
      "http://127.0.0.1/a.pdf",
      "http://10.0.0.5/a.pdf",
      "http://192.168.0.2/a.pdf",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/a.pdf",
      "file:///etc/passwd",
    ]) {
      expect(() => assertPublicHttpUrl(url)).toThrowError(/사설망|http/);
    }
  });

  it("rejects unknown schemas", () => {
    expect(() => normalizeOptions({ schema: "unknown" })).toThrowError(/schema/);
    expect(normalizeOptions({ mode: "text", schema: "invoice" }).schema).toBe("generic");
  });
});

describe("POST /v1/convert", () => {
  it("requires an API key", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/convert", {
      method: "POST",
      body: pdfForm(await readFixture("invoice.pdf")),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects a key with no credits", async () => {
    const { app, secret } = await setup({ credits: 0 });
    const response = await app.request("/v1/convert", {
      method: "POST",
      headers: authHeaders(secret),
      body: pdfForm(await readFixture("invoice.pdf")),
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: { code: "insufficient_credits", details: { requiredCredits: 1 } },
    });
  });

  it("converts in deterministic text mode and charges credits", async () => {
    const ctx = await setup({ credits: 3 });
    const response = await ctx.app.request("/v1/convert", {
      method: "POST",
      headers: authHeaders(ctx.secret),
      body: pdfForm(await readFixture("invoice.pdf"), { mode: "text" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-credits-charged")).toBe("1");
    const body = (await response.json()) as {
      jobId: string;
      status: string;
      document: { pageCount: number; mode: string };
      data: { pages: { page: number; text: string }[] };
      usage: { creditsCharged: number; creditsRemaining: number };
      meta: { provider: string };
    };

    expect(body.status).toBe("succeeded");
    expect(body.document.pageCount).toBe(3);
    expect(body.data.pages).toHaveLength(3);
    expect(body.data.pages[0]?.text).toContain("INVOICE");
    expect(body.usage).toMatchObject({ creditsCharged: 1, creditsRemaining: 2 });
    expect(body.meta.provider).toBe("deterministic");

    const balance = await ctx.store.getBalance(ctx.userId);
    expect(balance.balance).toBe(2);

    const job = await ctx.store.getJob(body.jobId);
    expect(job?.status).toBe("succeeded");
    expect(job?.creditsCharged).toBe(1);
  });

  it("structures the document with the AI service and logs usage", async () => {
    const ctx = await setup({ credits: 2, ai: fakeAi() });
    const response = await ctx.app.request("/v1/convert", {
      method: "POST",
      headers: authHeaders(ctx.secret),
      body: pdfForm(await readFixture("invoice.pdf"), { schema: "invoice" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jobId: string;
      data: { invoiceNumber: string };
      usage: { creditsCharged: number; inputTokens: number; costUsd: number };
      meta: { provider: string; model: string };
    };

    expect(body.data.invoiceNumber).toBe("INV-2026-0042");
    expect(body.meta).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-5" });
    expect(body.usage.inputTokens).toBe(1200);
    expect(body.usage.costUsd).toBeGreaterThan(0);

    const job = await ctx.store.getJob(body.jobId);
    expect(job?.provider).toBe("anthropic");
    expect(job?.inputTokens).toBe(1200);
  });

  it("refunds the credit when structuring fails", async () => {
    const failing = fakeAi({
      async structurePdf() {
        throw new Error("model exploded");
      },
    });
    const ctx = await setup({ credits: 2, ai: failing });

    const response = await ctx.app.request("/v1/convert", {
      method: "POST",
      headers: authHeaders(ctx.secret),
      body: pdfForm(await readFixture("invoice.pdf"), { schema: "invoice" }),
    });

    expect(response.status).toBe(500);
    expect((await ctx.store.getBalance(ctx.userId)).balance).toBe(2);

    const jobs = await ctx.store.listJobs(ctx.userId);
    expect(jobs[0]?.status).toBe("failed");
    expect(jobs[0]?.errorCode).toBe("internal_error");
  });

  it("rejects non-PDF uploads", async () => {
    const ctx = await setup({ credits: 1 });
    const form = new FormData();
    form.set("file", new File([new TextEncoder().encode("hello").buffer as ArrayBuffer], "note.txt", { type: "text/plain" }));

    const response = await ctx.app.request("/v1/convert", {
      method: "POST",
      headers: authHeaders(ctx.secret),
      body: form,
    });
    expect(response.status).toBe(415);
  });

  it("accepts JSON with a URL but blocks private hosts", async () => {
    const ctx = await setup({ credits: 1 });
    const response = await ctx.app.request("/v1/convert", {
      method: "POST",
      headers: { ...authHeaders(ctx.secret), "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:8080/secret.pdf" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "사설망 주소로는 접근할 수 없습니다." } });
  });
});
