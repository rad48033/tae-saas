import { handle } from "hono/vercel";

import { createApp } from "./app";
import { createDeps } from "./lib/deps";
import { loadEnv } from "./lib/load-env";

// Vercel Node 런타임 진입점. esbuild로 api/index.js에 번들됩니다.
loadEnv();

const app = createApp(createDeps());

export default handle(app);
