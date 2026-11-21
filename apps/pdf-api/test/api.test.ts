import { describe, expect, it } from "vitest";

import { authHeaders, readFixture, pdfForm, setup } from "./helpers";

describe("GET /health", () => {
  it("reports store and AI mode", async () => {
    const { app } = await setup();
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      services: { store: string; ai: string };
      version: string;
    };
    expect(body.status).toBe("ok");
    expect(body.services).toEqual({ store: "memory", ai: "demo", model: "demo-heuristic" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("describes the service at the root", async () => {
    const { app } = await setup();
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "tae-pdf-api" });
  });

  it("returns a JSON 404", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("GET /v1/me", () => {
  it("returns credits and key metadata", async () => {
    const ctx = await setup({ credits: 5 });
    const response = await ctx.app.request("/v1/me", { headers: authHeaders(ctx.secret) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { email: string };
      credits: { balance: number };
      apiKey: { prefix: string; name: string };
    };
    expect(body.user.email).toBe("user@example.com");
    expect(body.credits.balance).toBe(5);
    expect(body.apiKey.name).toBe("test");
    expect(body.apiKey.prefix).not.toContain(ctx.secret);
  });

  it("rejects a malformed key", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/me", { headers: { "x-api-key": "nope" } });
    expect(response.status).toBe(401);
  });
});

describe("GET /v1/jobs/:id", () => {
  it("returns the caller's job", async () => {
    const ctx = await setup({ credits: 2 });
    const convert = await ctx.app.request("/v1/convert", {
      method: "POST",
      headers: authHeaders(ctx.secret),
      body: pdfForm(await readFixture("invoice.pdf"), { mode: "text" }),
    });
    const { jobId } = (await convert.json()) as { jobId: string };

    const response = await ctx.app.request(`/v1/jobs/${jobId}`, { headers: authHeaders(ctx.secret) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: { id: jobId, status: "succeeded", creditsCharged: 1 } });
  });

  it("does not expose another user's job", async () => {
    const ctx = await setup({ credits: 2 });
    const convert = await ctx.app.request("/v1/convert", {
      method: "POST",
      headers: authHeaders(ctx.secret),
      body: pdfForm(await readFixture("invoice.pdf"), { mode: "text" }),
    });
    const { jobId } = (await convert.json()) as { jobId: string };

    const other = await ctx.store.createUser({ email: "other@example.com" });
    const otherKey = await ctx.store.createApiKey({ userId: other.id });

    const response = await ctx.app.request(`/v1/jobs/${jobId}`, { headers: authHeaders(otherKey.secret) });
    expect(response.status).toBe(404);
  });
});

describe("POST /v1/keys", () => {
  it("issues a key with initial credits for an admin", async () => {
    const { app, store } = await setup();
    const response = await app.request("/v1/keys", {
      method: "POST",
      headers: { Authorization: "Bearer admin_test_token", "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", name: "production", credits: 50 }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { key: string; credits: { balance: number }; apiKey: { prefix: string } };
    expect(body.key.startsWith("tae_live_")).toBe(true);
    expect(body.credits.balance).toBe(50);

    const found = await store.findApiKeyByHash(
      (await import("@tae/db")).hashApiKey(body.key),
    );
    expect(found?.name).toBe("production");
  });

  it("requires the admin token", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/keys", {
      method: "POST",
      headers: { Authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({ email: "x@example.com" }),
    });
    expect(response.status).toBe(401);
  });

  it("validates the email", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/keys", {
      method: "POST",
      headers: { Authorization: "Bearer admin_test_token", "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(response.status).toBe(400);
  });
});
