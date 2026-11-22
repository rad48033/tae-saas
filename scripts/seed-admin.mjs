#!/usr/bin/env node
/**
 * 관리자 계정 시드.
 *
 *   node --experimental-strip-types scripts/seed-admin.mjs
 *   node --experimental-strip-types scripts/seed-admin.mjs --email admin@taest.info --password '...'
 *   node --experimental-strip-types scripts/seed-admin.mjs --promote rad480@naver.com
 *
 * Supabase service role 키로 public.users에 role='admin' 계정을 만들거나 갱신합니다.
 * 비밀번호를 넘기지 않으면 안전한 난수를 만들어 표준출력에 한 번만 보여 줍니다.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hashPassword } from "../apps/youtube-blog/src/lib/auth/password.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function loadEnv() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] === undefined) process.env[key] = raw.replace(/^['"]|['"]$/g, "");
  }
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

loadEnv();

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다. tae-saas/.env를 확인하세요.");
  process.exit(1);
}

const headers = {
  apikey: key,
  authorization: `Bearer ${key}`,
  "content-type": "application/json",
};

async function request(pathname, init = {}) {
  const response = await fetch(`${url}/rest/v1/${pathname}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${pathname} → HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  return data;
}

async function findByEmail(email) {
  const rows = await request(`users?email=eq.${encodeURIComponent(email)}&select=id,email,role,signup_provider`);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function promote(email) {
  const existing = await findByEmail(email);
  if (!existing) {
    console.error(`[promote] ${email} 계정이 아직 없습니다. 그 이메일로 taest에 가입한 뒤 다시 실행하세요.`);
    return null;
  }
  await request(`users?id=eq.${existing.id}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "admin" }),
    headers: { prefer: "return=representation" },
  });
  return existing;
}

const promoteEmail = arg("promote");
if (promoteEmail) {
  const promoted = await promote(promoteEmail);
  console.log(JSON.stringify({ promoted: promoteEmail, userId: promoted?.id ?? null }, null, 2));
  process.exit(promoted ? 0 : 2);
}

const email = (arg("email") ?? "admin@taest.info").trim().toLowerCase();
const name = arg("name") ?? "taest 관리자";
const password = arg("password") ?? randomBytes(18).toString("base64url");
const now = new Date().toISOString();
const passwordHash = hashPassword(password);

const existing = await findByEmail(email);
if (existing) {
  await request(`users?id=eq.${existing.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      password_hash: passwordHash,
      role: "admin",
      display_name: name,
      signup_provider: "email",
      email_verified_at: now,
    }),
    headers: { prefer: "return=representation" },
  });
  console.log(
    JSON.stringify(
      { action: "updated", email, password, userId: existing.id, role: "admin", note: "기존 계정의 비밀번호를 새로 설정했습니다." },
      null,
      2,
    ),
  );
} else {
  const rows = await request("users", {
    method: "POST",
    body: JSON.stringify({
      email,
      display_name: name,
      password_hash: passwordHash,
      role: "admin",
      signup_provider: "email",
      email_verified_at: now,
    }),
    headers: { prefer: "return=representation" },
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  console.log(JSON.stringify({ action: "created", email, password, userId: created?.id ?? null, role: "admin" }, null, 2));
}
