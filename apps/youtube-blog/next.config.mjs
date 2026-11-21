import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

// 모노레포 루트의 .env를 읽어 Next 프로세스에 주입합니다(이미 있는 값은 유지).
const rootEnvPath = path.resolve(appDir, "../../.env");
if (fs.existsSync(rootEnvPath)) {
  for (const line of fs.readFileSync(rootEnvPath, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = (rawValue ?? "").replace(/^['"]|['"]$/g, "");
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 로컬 검증 시 .next가 잠겨 있으면 NEXT_DIST_DIR로 우회할 수 있습니다.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 워크스페이스 패키지는 TS 소스를 직접 내보내므로 Next가 함께 트랜스파일합니다.
  transpilePackages: ["@tae/ai", "@tae/db", "@tae/stripe"],
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
};

export default nextConfig;
