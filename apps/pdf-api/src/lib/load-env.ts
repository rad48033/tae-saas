import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

/**
 * 모노레포 루트의 .env를 먼저 찾고, 없으면 앱 로컬 .env를 읽습니다.
 * (이미 설정된 환경변수는 덮어쓰지 않습니다.)
 */
export function loadEnv(): void {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const candidates = [
    resolve(appRoot, "../../.env"),
    resolve(appRoot, ".env.local"),
    resolve(appRoot, ".env"),
  ];

  for (const file of candidates) {
    if (existsSync(file)) loadDotenv({ path: file });
  }
}
