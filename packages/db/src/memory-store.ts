import { randomUUID } from "node:crypto";

import { generateApiKey, hashApiKey } from "./keys";
import type {
  AdminAuditInput,
  CreateOAuthAccountInput,
  CreatePasswordResetInput,
  CreateUserInput,
  ListUsersInput,
  Store,
  UpdateUserInput,
} from "./store";
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
  PasswordResetRequest,
  PasswordResetRow,
  RecordWebhookInput,
  UpdateJobInput,
  User,
  WebhookEventRecord,
} from "./types";
import { StoreError } from "./types";

function now(): string {
  return new Date().toISOString();
}

function startOfToday(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

/**
 * Supabase 없이 앱을 띄울 때 쓰는 인메모리 저장소.
 * 프로세스가 재시작되면 데이터가 사라지며, 단일 인스턴스에서만 일관됩니다.
 */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;

  private readonly users = new Map<string, User & { passwordHash: string | null }>();
  private readonly balances = new Map<string, CreditBalance>();
  private readonly transactions = new Map<string, CreditTransaction[]>();
  private readonly apiKeys = new Map<string, ApiKeyRecord & { hash: string }>();
  private readonly orders = new Map<string, Order>();
  private readonly webhookEvents = new Map<string, WebhookEventRecord>();
  private readonly jobs = new Map<string, ConversionJob>();
  private readonly oauthAccounts = new Map<string, OAuthAccount>();
  private readonly auditLogs: AdminAuditInput[] = [];
  private readonly signupBonusGiven = new Set<string>();
  private readonly passwordResets = new Map<string, PasswordResetRequest & { tokenHash: string }>();

  async createUser(input: CreateUserInput = {}): Promise<User> {
    const email = input.email?.trim() || null;
    if (email) {
      const existing = await this.findUserByEmail(email);
      if (existing) return existing;
    }
    const user = {
      id: randomUUID(),
      email,
      displayName: input.displayName ?? null,
      createdAt: now(),
      role: input.role ?? "user",
      signupProvider: input.signupProvider ?? (email ? "email" : "guest"),
      hasPassword: Boolean(input.passwordHash),
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      lastLoginAt: null,
      passwordChangedAt: input.passwordHash ? now() : null,
      passwordHash: input.passwordHash ?? null,
    } satisfies User & { passwordHash: string | null };
    this.users.set(user.id, user);
    return publicUser(user);
  }

  async getUser(id: string): Promise<User | null> {
    const user = this.users.get(id);
    return user ? publicUser(user) : null;
  }

  /** 비밀번호 검증용: 사용자와 해시를 함께 읽습니다(서버 내부). */
  async getUserCredentials(email: string): Promise<{ user: User; passwordHash: string | null } | null> {
    const normalized = email.trim().toLowerCase();
    for (const row of this.users.values()) {
      if (row.email?.toLowerCase() === normalized) {
        return { user: publicUser(row), passwordHash: row.passwordHash };
      }
    }
    return null;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.email?.toLowerCase() === normalized) return publicUser(user);
    }
    return null;
  }

  async getOrCreateUserByEmail(email: string, displayName?: string | null): Promise<User> {
    const existing = await this.findUserByEmail(email);
    if (existing) return existing;
    return this.createUser({ email, displayName });
  }

  async updateUser(id: string, patch: UpdateUserInput): Promise<User> {
    const existing = this.users.get(id);
    if (!existing) throw new StoreError("사용자를 찾을 수 없습니다.", "not_found");
    const updated = {
      ...existing,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.passwordHash !== undefined
        ? {
            passwordHash: patch.passwordHash,
            hasPassword: Boolean(patch.passwordHash),
            ...(patch.passwordChangedAt !== undefined
              ? { passwordChangedAt: patch.passwordChangedAt }
              : patch.passwordHash
                ? { passwordChangedAt: now() }
                : {}),
          }
        : {}),
      ...(patch.passwordHash === undefined && patch.passwordChangedAt !== undefined
        ? { passwordChangedAt: patch.passwordChangedAt }
        : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.emailVerifiedAt !== undefined ? { emailVerifiedAt: patch.emailVerifiedAt } : {}),
      ...(patch.lastLoginAt !== undefined ? { lastLoginAt: patch.lastLoginAt } : {}),
      ...(patch.signupProvider !== undefined ? { signupProvider: patch.signupProvider } : {}),
    };
    this.users.set(id, updated);
    return publicUser(updated);
  }

  async findOAuthAccount(provider: OAuthProvider, providerUserId: string): Promise<OAuthAccount | null> {
    for (const account of this.oauthAccounts.values()) {
      if (account.provider === provider && account.providerUserId === providerUserId) return account;
    }
    return null;
  }

  async listOAuthAccounts(userId: string): Promise<OAuthAccount[]> {
    return [...this.oauthAccounts.values()].filter((account) => account.userId === userId);
  }

  async upsertOAuthAccount(input: CreateOAuthAccountInput): Promise<OAuthAccount> {
    const existing = await this.findOAuthAccount(input.provider, input.providerUserId);
    if (existing) {
      const updated: OAuthAccount = {
        ...existing,
        userId: input.userId,
        email: input.email ?? existing.email,
        nickname: input.nickname ?? existing.nickname,
        lastLoginAt: now(),
      };
      this.oauthAccounts.set(existing.id, updated);
      return updated;
    }
    const account: OAuthAccount = {
      id: randomUUID(),
      userId: input.userId,
      provider: input.provider,
      providerUserId: input.providerUserId,
      email: input.email ?? null,
      nickname: input.nickname ?? null,
      createdAt: now(),
      lastLoginAt: now(),
    };
    this.oauthAccounts.set(account.id, account);
    return account;
  }

  async transferJobs(fromUserId: string, toUserId: string): Promise<number> {
    if (fromUserId === toUserId) return 0;
    let moved = 0;
    for (const [id, job] of this.jobs) {
      if (job.userId === fromUserId) {
        this.jobs.set(id, { ...job, userId: toUserId });
        moved += 1;
      }
    }
    return moved;
  }

  async getBalance(userId: string): Promise<CreditBalance> {
    return (
      this.balances.get(userId) ?? {
        userId,
        balance: 0,
        lifetimeGranted: 0,
        lifetimeUsed: 0,
      }
    );
  }

  async grantSignupBonus(userId: string, amount: number): Promise<number> {
    if (this.signupBonusGiven.has(userId)) {
      return (await this.getBalance(userId)).balance;
    }
    this.signupBonusGiven.add(userId);
    return this.applyCredits({
      userId,
      amount,
      kind: "signup_bonus",
      description: "신규 가입 체험 크레딧",
    });
  }

  async grantCredits(input: GrantCreditsInput): Promise<number> {
    return this.applyCredits(input);
  }

  async consumeCredits(input: ConsumeCreditsInput): Promise<{ ok: boolean; balance: number }> {
    const current = await this.getBalance(input.userId);
    if (current.balance < input.amount) return { ok: false, balance: current.balance };

    const updated: CreditBalance = {
      ...current,
      balance: current.balance - input.amount,
      lifetimeUsed: current.lifetimeUsed + input.amount,
    };
    this.balances.set(input.userId, updated);
    this.pushTransaction({
      userId: input.userId,
      kind: "consume",
      amount: -input.amount,
      balanceAfter: updated.balance,
      jobId: input.jobId ?? null,
      orderId: null,
      description: input.description ?? null,
    });
    return { ok: true, balance: updated.balance };
  }

  async refundCredits(input: ConsumeCreditsInput): Promise<number> {
    const current = await this.getBalance(input.userId);
    const updated: CreditBalance = {
      ...current,
      balance: current.balance + input.amount,
      lifetimeUsed: Math.max(0, current.lifetimeUsed - input.amount),
    };
    this.balances.set(input.userId, updated);
    this.pushTransaction({
      userId: input.userId,
      kind: "refund",
      amount: input.amount,
      balanceAfter: updated.balance,
      jobId: input.jobId ?? null,
      orderId: null,
      description: input.description ?? "실패한 작업 크레딧 환불",
    });
    return updated.balance;
  }

  async listTransactions(userId: string, limit = 50): Promise<CreditTransaction[]> {
    return (this.transactions.get(userId) ?? []).slice(0, limit);
  }

  async createApiKey(input: { userId: string; name?: string }): Promise<{ record: ApiKeyRecord; secret: string }> {
    const generated = generateApiKey();
    const record: ApiKeyRecord = {
      id: randomUUID(),
      userId: input.userId,
      name: input.name?.trim() || "default",
      prefix: generated.prefix,
      scopes: ["convert"],
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now(),
    };
    this.apiKeys.set(record.id, { ...record, hash: generated.hash });
    return { record, secret: generated.secret };
  }

  async findApiKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
    for (const key of this.apiKeys.values()) {
      if (key.hash === hash && !key.revokedAt) {
        const { hash: _hash, ...record } = key;
        return record;
      }
    }
    return null;
  }

  async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    return [...this.apiKeys.values()]
      .filter((key) => key.userId === userId)
      .map(({ hash: _hash, ...record }) => record);
  }

  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const key = this.apiKeys.get(keyId);
    if (!key || key.userId !== userId) throw new StoreError("API 키를 찾을 수 없습니다.", "not_found");
    this.apiKeys.set(keyId, { ...key, revokedAt: now() });
  }

  async touchApiKey(keyId: string): Promise<void> {
    const key = this.apiKeys.get(keyId);
    if (key) this.apiKeys.set(keyId, { ...key, lastUsedAt: now() });
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    for (const order of this.orders.values()) {
      if (order.providerOrderId === input.providerOrderId) {
        const updated: Order = {
          ...order,
          status: input.status,
          creditsGranted: input.creditsGranted ?? order.creditsGranted,
        };
        this.orders.set(order.id, updated);
        return updated;
      }
    }
    const order: Order = {
      id: randomUUID(),
      userId: input.userId,
      provider: input.provider,
      providerOrderId: input.providerOrderId,
      variantId: input.variantId ?? null,
      packId: input.packId ?? null,
      status: input.status,
      totalCents: input.totalCents ?? null,
      currency: input.currency ?? null,
      buyerEmail: input.buyerEmail ?? null,
      creditsGranted: input.creditsGranted ?? 0,
      createdAt: now(),
    };
    this.orders.set(order.id, order);
    return order;
  }

  async recordWebhookEvent(input: RecordWebhookInput): Promise<{ isNew: boolean }> {
    if (this.webhookEvents.has(input.id)) return { isNew: false };
    this.webhookEvents.set(input.id, {
      id: input.id,
      provider: input.provider,
      eventName: input.eventName,
      status: "received",
      receivedAt: now(),
      processedAt: null,
      error: null,
    });
    return { isNew: true };
  }

  async getWebhookEvent(id: string): Promise<WebhookEventRecord | null> {
    return this.webhookEvents.get(id) ?? null;
  }

  async markWebhookEvent(id: string, status: string, error?: string): Promise<void> {
    const existing = this.webhookEvents.get(id);
    if (!existing) return;
    this.webhookEvents.set(id, {
      ...existing,
      status,
      error: error ?? null,
      processedAt: now(),
    });
  }

  async createJob(input: CreateJobInput): Promise<ConversionJob> {
    const job: ConversionJob = {
      id: randomUUID(),
      userId: input.userId,
      app: input.app,
      status: input.status ?? "queued",
      input: input.input ?? {},
      output: null,
      errorCode: null,
      errorMessage: null,
      provider: null,
      model: null,
      creditsCharged: 0,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      durationMs: null,
      createdAt: now(),
      completedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async updateJob(id: string, patch: UpdateJobInput): Promise<ConversionJob> {
    const job = this.jobs.get(id);
    if (!job) throw new StoreError("작업을 찾을 수 없습니다.", "not_found");
    const updated: ConversionJob = { ...job, ...patch };
    this.jobs.set(id, updated);
    return updated;
  }

  async getJob(id: string): Promise<ConversionJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async listJobs(userId: string, limit = 20): Promise<ConversionJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listAdminUsers(input: ListUsersInput = {}): Promise<{ users: AdminUserRow[]; total: number }> {
    const query = input.query?.trim().toLowerCase() ?? "";
    const limit = Math.min(100, Math.max(1, input.limit ?? 30));
    const offset = Math.max(0, input.offset ?? 0);

    const matched = [...this.users.values()]
      .filter((user) => {
        if (!query) return true;
        return (
          user.id.toLowerCase().includes(query) ||
          (user.email ?? "").toLowerCase().includes(query) ||
          (user.displayName ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const page = matched.slice(offset, offset + limit);
    const users: AdminUserRow[] = await Promise.all(
      page.map(async (user) => {
        const balance = await this.getBalance(user.id);
        return {
          user: publicUser(user),
          balance: balance.balance,
          lifetimeGranted: balance.lifetimeGranted,
          lifetimeUsed: balance.lifetimeUsed,
          oauthProviders: (await this.listOAuthAccounts(user.id)).map((account) => account.provider),
        };
      }),
    );

    return { users, total: matched.length };
  }

  async getAdminOverview(): Promise<AdminOverview> {
    const users = [...this.users.values()];
    const jobs = [...this.jobs.values()];
    const balances = [...this.balances.values()];
    const today = startOfToday();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const isVideo = (job: ConversionJob) =>
      (job.output as { format?: unknown } | null)?.format === "youtube_video" ||
      (job.input as { format?: unknown }).format === "youtube_video";
    const videoJobs = jobs.filter(isVideo).length;

    return {
      totalUsers: users.length,
      todayUsers: users.filter((user) => user.createdAt >= today).length,
      weekUsers: users.filter((user) => user.createdAt >= weekAgo).length,
      adminUsers: users.filter((user) => user.role === "admin").length,
      members: users.filter((user) => user.signupProvider !== "guest").length,
      guests: users.filter((user) => user.signupProvider === "guest").length,
      totalJobs: jobs.length,
      todayJobs: jobs.filter((job) => job.createdAt >= today).length,
      textJobs: jobs.length - videoJobs,
      videoJobs,
      succeededJobs: jobs.filter((job) => job.status === "succeeded").length,
      failedJobs: jobs.filter((job) => job.status === "failed").length,
      creditBalance: balances.reduce((sum, row) => sum + row.balance, 0),
      creditGranted: balances.reduce((sum, row) => sum + row.lifetimeGranted, 0),
      creditUsed: balances.reduce((sum, row) => sum + row.lifetimeUsed, 0),
    };
  }

  async listRecentJobs(limit = 50): Promise<AdminJobRow[]> {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(200, Math.max(1, limit)))
      .map((job) => {
        const user = this.users.get(job.userId);
        return {
          ...job,
          userEmail: user?.email ?? null,
          userDisplayName: user?.displayName ?? null,
        };
      });
  }

  async countAdmins(): Promise<number> {
    return [...this.users.values()].filter((user) => user.role === "admin").length;
  }

  async recordAdminAction(input: AdminAuditInput): Promise<void> {
    this.auditLogs.unshift(input);
    if (this.auditLogs.length > 1000) this.auditLogs.length = 1000;
  }

  async checkHealth(): Promise<boolean> {
    return true;
  }

  async createPasswordReset(input: CreatePasswordResetInput): Promise<PasswordResetRequest> {
    const user = this.users.get(input.userId);
    if (!user) throw new StoreError("사용자를 찾을 수 없습니다.", "not_found");

    const record = {
      id: randomUUID(),
      userId: input.userId,
      email: user.email ?? null,
      delivery: input.delivery,
      requestedIp: input.requestedIp ?? null,
      expiresAt: input.expiresAt,
      usedAt: null,
      createdAt: now(),
      tokenHash: input.tokenHash,
    } satisfies PasswordResetRequest & { tokenHash: string };

    this.passwordResets.set(record.id, record);
    return publicReset(record);
  }

  async consumePasswordReset(tokenHash: string): Promise<PasswordResetRequest | null> {
    const current = Date.now();
    for (const record of this.passwordResets.values()) {
      if (record.tokenHash !== tokenHash) continue;
      if (record.usedAt) return null;
      if (new Date(record.expiresAt).getTime() <= current) return null;
      record.usedAt = now();
      return publicReset(record);
    }
    return null;
  }

  async invalidatePasswordResets(userId: string): Promise<number> {
    const current = now();
    let invalidated = 0;
    for (const record of this.passwordResets.values()) {
      if (record.userId !== userId || record.usedAt) continue;
      record.usedAt = current;
      invalidated += 1;
    }
    return invalidated;
  }

  async listPendingPasswordResets(limit = 50): Promise<PasswordResetRow[]> {
    const current = Date.now();
    return [...this.passwordResets.values()]
      .filter((record) => !record.usedAt && new Date(record.expiresAt).getTime() > current)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, limit))
      .map((record) => {
        const user = this.users.get(record.userId);
        return {
          ...publicReset(record),
          displayName: user?.displayName ?? null,
          hasPassword: Boolean(user?.passwordHash),
        };
      });
  }

  private applyCredits(input: GrantCreditsInput): number {
    const current =
      this.balances.get(input.userId) ?? {
        userId: input.userId,
        balance: 0,
        lifetimeGranted: 0,
        lifetimeUsed: 0,
      };

    const nextBalance = current.balance + input.amount;
    if (nextBalance < 0) throw new StoreError("잔액이 부족합니다.", "insufficient_credits");

    const updated: CreditBalance = {
      ...current,
      balance: nextBalance,
      lifetimeGranted: current.lifetimeGranted + Math.max(input.amount, 0),
      lifetimeUsed: current.lifetimeUsed + Math.max(-input.amount, 0),
    };
    this.balances.set(input.userId, updated);
    this.pushTransaction({
      userId: input.userId,
      kind: input.kind,
      amount: input.amount,
      balanceAfter: nextBalance,
      jobId: null,
      orderId: input.orderId ?? null,
      description: input.description ?? null,
    });
    return nextBalance;
  }

  private pushTransaction(input: Omit<CreditTransaction, "id" | "createdAt">): void {
    const list = this.transactions.get(input.userId) ?? [];
    list.unshift({ ...input, id: randomUUID(), createdAt: now() });
    this.transactions.set(input.userId, list.slice(0, 200));
  }
}

function publicReset(record: PasswordResetRequest & { tokenHash?: string }): PasswordResetRequest {
  const { tokenHash: _tokenHash, ...rest } = record;
  return rest;
}

function publicUser(user: User & { passwordHash?: string | null }): User {
  const { passwordHash: _passwordHash, ...rest } = user;
  return {
    ...rest,
    passwordChangedAt: rest.passwordChangedAt ?? null,
    hasPassword: user.hasPassword ?? Boolean(user.passwordHash),
  };
}

export { hashApiKey };
