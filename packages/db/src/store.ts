import type {
  AdminJobRow,
  AdminOverview,
  AdminUserRow,
  ApiKeyRecord,
  ConversionJob,
  CreateJobInput,
  CreateOrderInput,
  CreditBalance,
  CreditTransaction,
  GrantCreditsInput,
  ConsumeCreditsInput,
  OAuthAccount,
  OAuthProvider,
  Order,
  RecordWebhookInput,
  SignupProvider,
  UpdateJobInput,
  User,
  UserRole,
  WebhookEventRecord,
} from "./types";

export interface CreateUserInput {
  email?: string | null;
  displayName?: string | null;
  passwordHash?: string | null;
  role?: UserRole;
  signupProvider?: SignupProvider;
  emailVerifiedAt?: string | null;
}

export interface UpdateUserInput {
  displayName?: string | null;
  passwordHash?: string | null;
  role?: UserRole;
  emailVerifiedAt?: string | null;
  lastLoginAt?: string | null;
  signupProvider?: SignupProvider;
}

export interface CreateOAuthAccountInput {
  userId: string;
  provider: OAuthProvider;
  providerUserId: string;
  email?: string | null;
  nickname?: string | null;
  raw?: Record<string, unknown>;
}

export interface ListUsersInput {
  /** 이메일·이름·ID 부분 검색 */
  query?: string;
  limit?: number;
  offset?: number;
}

export interface UserCredentials {
  user: User;
  /** scrypt 해시(소셜 전용 계정은 null). 서버 인증 경로에서만 사용하세요. */
  passwordHash: string | null;
}

export interface AdminAuditInput {
  adminUserId: string;
  action: string;
  targetUserId?: string | null;
  amount?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
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
  /** 로그인 검증용: 사용자와 비밀번호 해시를 함께 읽습니다. */
  getUserCredentials(email: string): Promise<UserCredentials | null>;
  getOrCreateUserByEmail(email: string, displayName?: string | null): Promise<User>;
  updateUser(id: string, patch: UpdateUserInput): Promise<User>;

  findOAuthAccount(provider: OAuthProvider, providerUserId: string): Promise<OAuthAccount | null>;
  listOAuthAccounts(userId: string): Promise<OAuthAccount[]>;
  /** 같은 provider/계정이 이미 있으면 그것을 갱신해 돌려줍니다. */
  upsertOAuthAccount(input: CreateOAuthAccountInput): Promise<OAuthAccount>;
  /** 체험 세션에서 만든 작업을 로그인 계정으로 옮깁니다(크레딧은 옮기지 않음). */
  transferJobs(fromUserId: string, toUserId: string): Promise<number>;

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

  listAdminUsers(input?: ListUsersInput): Promise<{ users: AdminUserRow[]; total: number }>;
  getAdminOverview(): Promise<AdminOverview>;
  listRecentJobs(limit?: number): Promise<AdminJobRow[]>;
  countAdmins(): Promise<number>;
  recordAdminAction(input: AdminAuditInput): Promise<void>;

  checkHealth(): Promise<boolean>;
}
