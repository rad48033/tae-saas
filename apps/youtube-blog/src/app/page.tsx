import { resolvePacks, resolveSubscriptions } from "@tae/stripe";

import { AppShell } from "@/components/app-shell";
import { CREDIT_COSTS, getRuntime } from "@/lib/runtime";
import { getVideoConfig } from "@/lib/video";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const runtime = getRuntime();
  const videoConfig = getVideoConfig();

  return (
    <AppShell
      packs={resolvePacks(process.env)}
      subscriptions={resolveSubscriptions(process.env)}
      costs={CREDIT_COSTS}
      aiMode={runtime.aiMode}
      storeMode={runtime.storeMode}
      videoMode={videoConfig.mode}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://taest.info"}
    />
  );
}
