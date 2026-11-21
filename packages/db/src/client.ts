import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

/**
 * 서버 전용 Supabase 클라이언트.
 * service role 키를 쓰므로 브라우저 번들에 절대 포함하지 마세요.
 */
export function createSupabaseAdminClient(config: SupabaseConfig): SupabaseClient {
  if (!config.url || !config.serviceRoleKey) {
    throw new Error("Supabase URL과 service role 키가 필요합니다.");
  }

  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "tae-saas" } },
  });
}
