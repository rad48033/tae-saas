/** 도메인 타입. Supabase/인메모리 구현 모두 이 타입을 반환합니다. */

export type UserRole = "user" | "admin";
export type SignupProvider = "email" | "naver" | "kakao" | "guest";
export type OAuthProvider = "naver" | "kakao";

export interface User {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  role: UserRole;
  signupProvider: SignupProvider;
  /** 이메일/비밀번호로 로그인할 수 있는 계정인지(소셜 전용은 false) */
  hasPassword: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  /** 비밀번호를 마지막으로 바꾼 시각. 이 시각보다 먼저 발급된 세션은 무효입니다. */
  passwordChangedAt: string | null;
}

/** 비밀번호 재설정 요청(토큰은 해시로만 보관). */
export type PasswordResetDelivery = "email" | "admin" | "link";

export interface PasswordResetRequest {
  id: string;
  userId: string;
  email: string | null;
  delivery: PasswordResetDelivery;
  requestedIp: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

/** 관리자 화면에 보여 줄 재설정 요청 한 줄 */
export interface PasswordResetRow extends PasswordResetRequest {
  displayName: string | null;
  hasPassword: boolean;
}

export interface OAuthAccount {
  id: string;
  userId: string;
  provider: OAuthProvider;
  providerUserId: string;
  email: string | null;
  nickname: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUserRow {
  user: User;
  balance: number;
  lifetimeGranted: number;
  lifetimeUsed: number;
  oauthProviders: OAuthProvider[];
}

export interface AdminOverview {
  totalUsers: number;
  todayUsers: number;
  weekUsers: number;
  adminUsers: number;
  members: number;
  guests: number;
  totalJobs: number;
  todayJobs: number;
  textJobs: number;
  videoJobs: number;
  succeededJobs: number;
  failedJobs: number;
  creditBalance: number;
  creditGranted: number;
  creditUsed: number;
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

export interface AdminJobRow extends ConversionJob {
  userEmail: string | null;
  userDisplayName: string | null;
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
