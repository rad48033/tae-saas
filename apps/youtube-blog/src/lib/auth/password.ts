import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 비밀번호 해시(scrypt, Node 내장 crypto만 사용).
 * 저장 형식: scrypt$N$r$p$salt_base64$hash_base64
 * 같은 형식을 scripts/seed-admin.mjs가 사용해 관리자 계정을 시드합니다.
 */
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const PREFIX = "scrypt";
const MAX_MEMORY = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAX_MEMORY,
  });
  return [PREFIX, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 1024 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64");
    expected = Buffer.from(parts[5] ?? "", "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAX_MEMORY,
    });
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** 8~128자, 공백만으로는 안 됩니다. 문제가 있으면 안내 문구를 돌려줍니다. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "비밀번호는 8자 이상으로 정해 주세요.";
  if (password.length > 128) return "비밀번호는 128자 이하로 정해 주세요.";
  if (!password.trim()) return "비밀번호에 공백만 쓸 수는 없습니다.";
  return null;
}

/**
 * 계정이 없을 때도 같은 시간이 걸리게 하는 더미 해시.
 * (계정 존재 여부를 응답 시간으로 알아내지 못하게 합니다.)
 */
let dummyHash: string | null = null;
export function dummyPasswordHash(): string {
  dummyHash ??= hashPassword(`dummy-${randomBytes(16).toString("hex")}`);
  return dummyHash;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
