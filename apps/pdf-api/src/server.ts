import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { createDeps } from "./lib/deps";
import { loadEnv } from "./lib/load-env";

loadEnv();

const deps = createDeps();
const app = createApp(deps);
const port = Number(process.env.PORT ?? 8787);

if (deps.config.storeMode === "memory") {
  console.warn(
    "[pdf-api] 인메모리 저장소로 실행 중입니다. 발급한 API 키도 재시작하면 사라집니다.\n" +
      "          .env에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 설정하세요.",
  );
}
if (deps.config.aiMode === "demo") {
  console.warn("[pdf-api] ANTHROPIC_API_KEY가 없어 데모 모드로 실행합니다(휴리스틱 구조화).");
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[pdf-api] http://localhost:${info.port} (store=${deps.config.storeMode}, ai=${deps.config.aiMode})`);
});
