import { defineConfig } from "vitest/config";

// 이 실행 환경에는 /etc/hosts가 없어 "localhost"가 해석되지 않을 수 있습니다.
export default defineConfig({
  test: { environment: "node", testTimeout: 120_000 },
  server: { host: "127.0.0.1" },
});
