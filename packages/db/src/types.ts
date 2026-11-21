/** 도메인 타입. Supabase/인메모리 구현 모두 이 타입을 반환합니다. */

export interface User {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
}

export type CreditTransactionKind = "signup_bonus" | "purchase" | "consume" | "refund" | "adjustment";

export interface CreditBalance {
  userId: string;
  balance: number;
  lifetimeGranted: number;
  lifetimeUsed: number;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  kind: CreditTransactionKind;
  /** 양수 = 지급, 음수 = 차감 */
  amount: number;
  balanceAfter: number;
  jobId: string | null;
  orderId: string | null;
  description: string | null;
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export type JobApp = "youtube_blog" | "pdf_api";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface ConversionJob {
  id: string;
  userId: string;
  app: JobApp;
  status: JobStatus;
  input: Record<string, unknown>;
  output: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
  provider: string | null;
  model: string | null;
  creditsCharged: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface Order {
  id: string;
  userId: string | null;
  provider: string;
  providerOrderId: string;
  variantId: string | null;
  packId: string | null;
  status: string;
  totalCents: number | null;
  currency: string | null;
  buyerEmail: string | null;
  creditsGranted: number;
  createdAt: string;
}

export interface WebhookEventRecord {
  id: string;
  provider: string;
  eventName: string;
  status: string;
  receivedAt: string;
  processedAt: string | null;
  error: string | null;
}

export interface GrantCreditsInput {
  userId: string;
  amount: number;
  kind: CreditTransactionKind;
  description?: string;
  orderId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ConsumeCreditsInput {
  userId: string;
  amount: number;
  jobId?: string | null;
  description?: string;
}

export interface CreateJobInput {
  userId: string;
  app: JobApp;
  status?: JobStatus;
  input?: Record<string, unknown>;
}

export interface UpdateJobInput {
  status?: JobStatus;
  output?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  provider?: string | null;
  model?: string | null;
  creditsCharged?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  durationMs?: number | null;
  completedAt?: string | null;
}

export interface CreateOrderInput {
  userId: string | null;
  provider: string;
  providerOrderId: string;
  variantId?: string | null;
  packId?: string | null;
  status: string;
  totalCents?: number | null;
  currency?: string | null;
  buyerEmail?: string | null;
  creditsGranted?: number;
}

export interface RecordWebhookInput {
  id: string;
  provider: string;
  eventName: string;
  payload: Record<string, unknown>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: "conflict" | "not_found" | "insufficient_credits" | "unknown" = "unknown",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "StoreError";
  }
}
