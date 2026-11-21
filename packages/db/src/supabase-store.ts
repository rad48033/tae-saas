import type { SupabaseClient } from "@supabase/supabase-js";

import { generateApiKey } from "./keys";
import type { CreateUserInput, Store } from "./store";
import type {
  ApiKeyRecord,
  ConversionJob,
  CreateJobInput,
  CreateOrderInput,
  CreditBalance,
  CreditTransaction,
  GrantCreditsInput,
  ConsumeCreditsInput,
  JobApp,
  JobStatus,
  Order,
  RecordWebhookInput,
  UpdateJobInput,
  User,
  WebhookEventRecord,
} from "./types";
import { StoreError } from "./types";

interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
}

interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  scopes: string[] | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface CreditRow {
  user_id: string;
  balance: number;
  lifetime_granted: number;
  lifetime_used: number;
}

interface TransactionRow {
  id: string;
  user_id: string;
  kind: CreditTransaction["kind"];
  amount: number;
  balance_after: number;
  job_id: string | null;
  order_id: string | null;
  description: string | null;
  created_at: string;
}

interface OrderRow {
  id: string;
  user_id: string | null;
  provider: string;
  provider_order_id: string;
  variant_id: string | null;
  pack_id: string | null;
  status: string;
  total_cents: number | null;
  currency: string | null;
  buyer_email: string | null;
  credits_granted: number;
  created_at: string;
}

interface JobRow {
  id: string;
  user_id: string;
  app: JobApp;
  status: JobStatus;
  input: Record<string, unknown> | null;
  output: unknown | null;
  error_code: string | null;
  error_message: string | null;
  provider: string | null;
  model: string | null;
  credits_charged: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | string | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

const UNIQUE_VIOLATION = "23505";

function mapErrorCode(code: string | undefined): StoreError["code"] {
  if (code === UNIQUE_VIOLATION) return "conflict";
  if (code === "P0001") return "insufficient_credits";
  if (code === "PGRST116") return "not_found";
  return "unknown";
}

function fail(error: { message: string; code?: string } | null): never {
  throw new StoreError(error?.message ?? "Supabase 오류", mapErrorCode(error?.code), error);
}

/**
 * 운영 저장소. 크레딧 증감은 Postgres 함수(RPC)로 원자 처리합니다.
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;

  constructor(private readonly client: SupabaseClient) {}

  async createUser(input: CreateUserInput = {}): Promise<User> {
    const email = input.email?.trim() || null;
    const { data, error } = await this.client
      .from("users")
      .insert({ email, display_name: input.displayName ?? null })
      .select("*")
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION && email) {
        const existing = await this.findUserByEmail(email);
        if (existing) return existing;
      }
      fail(error);
    }

    return mapUser(data as UserRow);
  }

  async getUser(id: string): Promise<User | null> {
    const { data, error } = await this.client.from("users").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? mapUser(data as UserRow) : null;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .ilike("email", email.trim())
      .maybeSingle();
    if (error) fail(error);
    return data ? mapUser(data as UserRow) : null;
  }

  async getOrCreateUserByEmail(email: string, displayName?: string | null): Promise<User> {
    const existing = await this.findUserByEmail(email);
    if (existing) return existing;
    return this.createUser({ email, displayName });
  }

  async getBalance(userId: string): Promise<CreditBalance> {
    const { data, error } = await this.client.from("usage_credits").select("*").eq("user_id", userId).maybeSingle();
    if (error) fail(error);
    if (!data) return { userId, balance: 0, lifetimeGranted: 0, lifetimeUsed: 0 };
    const row = data as CreditRow;
    return {
      userId: row.user_id,
      balance: row.balance,
      lifetimeGranted: row.lifetime_granted,
      lifetimeUsed: row.lifetime_used,
    };
  }

  async grantSignupBonus(userId: string, amount: number): Promise<number> {
    const { data, error } = await this.client.rpc("grant_signup_bonus", {
      p_user_id: userId,
      p_amount: amount,
    });
    if (error) fail(error);
    return Number(data ?? 0);
  }

  async grantCredits(input: GrantCreditsInput): Promise<number> {
    const { data, error } = await this.client.rpc("grant_credits", {
      p_user_id: input.userId,
      p_amount: input.amount,
      p_kind: input.kind,
      p_description: input.description ?? null,
      p_order_id: input.orderId ?? null,
      p_metadata: input.metadata ?? {},
    });
    if (error) fail(error);
    return Number(data ?? 0);
  }

  async consumeCredits(input: ConsumeCreditsInput): Promise<{ ok: boolean; balance: number }> {
    const { data, error } = await this.client.rpc("consume_credits", {
      p_user_id: input.userId,
      p_amount: input.amount,
      p_job_id: input.jobId ?? null,
      p_description: input.description ?? null,
    });
    if (error) fail(error);

    const balance = Number(data ?? -1);
    if (balance < 0) {
      const current = await this.getBalance(input.userId);
      return { ok: false, balance: current.balance };
    }
    return { ok: true, balance };
  }

  async refundCredits(input: ConsumeCreditsInput): Promise<number> {
    const { data, error } = await this.client.rpc("refund_credits", {
      p_user_id: input.userId,
      p_amount: input.amount,
      p_job_id: input.jobId ?? null,
      p_description: input.description ?? "실패한 작업 크레딧 환불",
    });
    if (error) fail(error);
    return Number(data ?? 0);
  }

  async listTransactions(userId: string, limit = 50): Promise<CreditTransaction[]> {
    const { data, error } = await this.client
      .from("credit_transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return ((data ?? []) as TransactionRow[]).map(mapTransaction);
  }

  async createApiKey(input: { userId: string; name?: string }): Promise<{ record: ApiKeyRecord; secret: string }> {
    const generated = generateApiKey();
    const { data, error } = await this.client
      .from("api_keys")
      .insert({
        user_id: input.userId,
        name: input.name?.trim() || "default",
        key_prefix: generated.prefix,
        key_hash: generated.hash,
        scopes: ["convert"],
      })
      .select("*")
      .single();

    if (error) fail(error);
    return { record: mapApiKey(data as ApiKeyRow), secret: generated.secret };
  }

  async findApiKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
    const { data, error } = await this.client
      .from("api_keys")
      .select("*")
      .eq("key_hash", hash)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) fail(error);
    return data ? mapApiKey(data as ApiKeyRow) : null;
  }

  async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    const { data, error } = await this.client
      .from("api_keys")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as ApiKeyRow[]).map(mapApiKey);
  }

  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const { error } = await this.client
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId)
      .eq("user_id", userId);
    if (error) fail(error);
  }

  async touchApiKey(keyId: string): Promise<void> {
    const { error } = await this.client
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyId);
    if (error) fail(error);
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const { data, error } = await this.client
      .from("orders")
      .upsert(
        {
          user_id: input.userId,
          provider: input.provider,
          provider_order_id: input.providerOrderId,
          variant_id: input.variantId ?? null,
          pack_id: input.packId ?? null,
          status: input.status,
          total_cents: input.totalCents ?? null,
          currency: input.currency ?? null,
          buyer_email: input.buyerEmail ?? null,
          credits_granted: input.creditsGranted ?? 0,
        },
        { onConflict: "provider_order_id" },
      )
      .select("*")
      .single();

    if (error) fail(error);
    return mapOrder(data as OrderRow);
  }

  async recordWebhookEvent(input: RecordWebhookInput): Promise<{ isNew: boolean }> {
    const { data, error } = await this.client
      .from("webhook_events")
      .upsert(
        {
          id: input.id,
          provider: input.provider,
          event_name: input.eventName,
          payload: input.payload,
          status: "received",
        },
        { onConflict: "id", ignoreDuplicates: true },
      )
      .select("id");

    if (error) fail(error);
    return { isNew: (data ?? []).length > 0 };
  }

  async getWebhookEvent(id: string): Promise<WebhookEventRecord | null> {
    const { data, error } = await this.client
      .from("webhook_events")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const row = data as {
      id: string;
      provider: string;
      event_name: string;
      status: string;
      received_at: string;
      processed_at: string | null;
      error: string | null;
    };
    return {
      id: row.id,
      provider: row.provider,
      eventName: row.event_name,
      status: row.status,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
      error: row.error,
    };
  }

  async markWebhookEvent(id: string, status: string, error?: string): Promise<void> {
    const { error: updateError } = await this.client
      .from("webhook_events")
      .update({
        status,
        error: error ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) fail(updateError);
  }

  async createJob(input: CreateJobInput): Promise<ConversionJob> {
    const { data, error } = await this.client
      .from("conversion_jobs")
      .insert({
        user_id: input.userId,
        app: input.app,
        status: input.status ?? "queued",
        input: input.input ?? {},
      })
      .select("*")
      .single();
    if (error) fail(error);
    return mapJob(data as JobRow);
  }

  async updateJob(id: string, patch: UpdateJobInput): Promise<ConversionJob> {
    const payload: Record<string, unknown> = {};
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.output !== undefined) payload.output = patch.output;
    if (patch.errorCode !== undefined) payload.error_code = patch.errorCode;
    if (patch.errorMessage !== undefined) payload.error_message = patch.errorMessage;
    if (patch.provider !== undefined) payload.provider = patch.provider;
    if (patch.model !== undefined) payload.model = patch.model;
    if (patch.creditsCharged !== undefined) payload.credits_charged = patch.creditsCharged;
    if (patch.inputTokens !== undefined) payload.input_tokens = patch.inputTokens;
    if (patch.outputTokens !== undefined) payload.output_tokens = patch.outputTokens;
    if (patch.costUsd !== undefined) payload.cost_usd = patch.costUsd;
    if (patch.durationMs !== undefined) payload.duration_ms = patch.durationMs;
    if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt;

    const { data, error } = await this.client
      .from("conversion_jobs")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) fail(error);
    return mapJob(data as JobRow);
  }

  async getJob(id: string): Promise<ConversionJob | null> {
    const { data, error } = await this.client.from("conversion_jobs").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? mapJob(data as JobRow) : null;
  }

  async listJobs(userId: string, limit = 20): Promise<ConversionJob[]> {
    const { data, error } = await this.client
      .from("conversion_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return ((data ?? []) as JobRow[]).map(mapJob);
  }

  async checkHealth(): Promise<boolean> {
    const { error } = await this.client.from("users").select("id", { head: true, count: "exact" }).limit(1);
    return !error;
  }
}

function mapUser(row: UserRow): User {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

function mapApiKey(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prefix: row.key_prefix,
    scopes: row.scopes ?? [],
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

function mapTransaction(row: TransactionRow): CreditTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    amount: row.amount,
    balanceAfter: row.balance_after,
    jobId: row.job_id,
    orderId: row.order_id,
    description: row.description,
    createdAt: row.created_at,
  };
}

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    variantId: row.variant_id,
    packId: row.pack_id,
    status: row.status,
    totalCents: row.total_cents,
    currency: row.currency,
    buyerEmail: row.buyer_email,
    creditsGranted: row.credits_granted,
    createdAt: row.created_at,
  };
}

function mapJob(row: JobRow): ConversionJob {
  return {
    id: row.id,
    userId: row.user_id,
    app: row.app,
    status: row.status,
    input: row.input ?? {},
    output: row.output,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    provider: row.provider,
    model: row.model,
    creditsCharged: row.credits_charged,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
