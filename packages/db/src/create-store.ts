import { createSupabaseAdminClient } from "./client";
import { MemoryStore } from "./memory-store";
import type { Store } from "./store";
import { SupabaseStore } from "./supabase-store";

export interface StoreEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
  [key: string]: string | undefined;
}

export interface StoreSelection {
  store: Store;
  mode: "supabase" | "memory";
  warning?: string;
}

let warned = false;

/**
 * 환경변수가 있으면 Supabase, 없으면 인메모리.
 * 인메모리는 로컬 데모 전용이며 배포 환경에서는 반드시 Supabase를 설정해야 합니다.
 */
export function createStoreFromEnv(env: StoreEnv = process.env): StoreSelection {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (url && key) {
    return { store: new SupabaseStore(createSupabaseAdminClient({ url, serviceRoleKey: key })), mode: "supabase" };
  }

  const warning =
    "Supabase 환경변수가 없어 인메모리 저장소로 실행합니다. 서버를 재시작하면 데이터가 사라집니다.";
  if (!warned) {
    warned = true;
    console.warn(`[db] ${warning}`);
  }
  return { store: new MemoryStore(), mode: "memory", warning };
}
