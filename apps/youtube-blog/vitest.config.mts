import { defineConfig } from "vitest/config";

// 이 실행 환경에는 /etc/hosts가 없어 "localhost"가 해석되지 않을 수 있습니다.
// Vite 서버를 루프백 IP로 고정해 어디서든 테스트가 뜨도록 합니다.
export default defineConfig({
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  esbuild: { jsx: "automatic" },
  test: { environment: "node" },
  server: { host: "127.0.0.1" },
});
