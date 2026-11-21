import type {
  ApiKeyRecord,
  ConversionJob,
  CreateJobInput,
  CreateOrderInput,
  CreditBalance,
  CreditTransaction,
  GrantCreditsInput,
  ConsumeCreditsInput,
  Order,
  RecordWebhookInput,
  UpdateJobInput,
  User,
  WebhookEventRecord,
} from "./types";

export interface CreateUserInput {
  email?: string | null;
  displayName?: string | null;
}

/**
 * 두 앱이 공유하는 저장소 계약.
 * Supabase(운영)와 인메모리(로컬/테스트) 구현이 같은 의미론을 따릅니다.
 */
export interface Store {
  readonly kind: "supabase" | "memory";

  createUser(input?: CreateUserInput): Promise<User>;
  getUser(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  getOrCreateUserByEmail(email: string, displayName?: string | null): Promise<User>;

  getBalance(userId: string): Promise<CreditBalance>;
  /** 신규 사용자 체험 크레딧. 이미 지급된 사용자면 현재 잔액을 그대로 반환합니다. */
  grantSignupBonus(userId: string, amount: number): Promise<number>;
  grantCredits(input: GrantCreditsInput): Promise<number>;
  consumeCredits(input: ConsumeCreditsInput): Promise<{ ok: boolean; balance: number }>;
  refundCredits(input: ConsumeCreditsInput): Promise<number>;
  listTransactions(userId: string, limit?: number): Promise<CreditTransaction[]>;

  createApiKey(input: { userId: string; name?: string }): Promise<{ record: ApiKeyRecord; secret: string }>;
  findApiKeyByHash(hash: string): Promise<ApiKeyRecord | null>;
  listApiKeys(userId: string): Promise<ApiKeyRecord[]>;
  revokeApiKey(userId: string, keyId: string): Promise<void>;
  touchApiKey(keyId: string): Promise<void>;

  createOrder(input: CreateOrderInput): Promise<Order>;
  recordWebhookEvent(input: RecordWebhookInput): Promise<{ isNew: boolean }>;
  getWebhookEvent(id: string): Promise<WebhookEventRecord | null>;
  markWebhookEvent(id: string, status: string, error?: string): Promise<void>;

  createJob(input: CreateJobInput): Promise<ConversionJob>;
  updateJob(id: string, patch: UpdateJobInput): Promise<ConversionJob>;
  getJob(id: string): Promise<ConversionJob | null>;
  listJobs(userId: string, limit?: number): Promise<ConversionJob[]>;

  checkHealth(): Promise<boolean>;
}
