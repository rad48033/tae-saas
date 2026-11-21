import { randomUUID } from "node:crypto";

import { generateApiKey, hashApiKey } from "./keys";
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
  Order,
  RecordWebhookInput,
  UpdateJobInput,
  User,
  WebhookEventRecord,
} from "./types";
import { StoreError } from "./types";

function now(): string {
  return new Date().toISOString();
}

/**
 * Supabase 없이 앱을 띄울 때 쓰는 인메모리 저장소.
 * 프로세스가 재시작되면 데이터가 사라지며, 단일 인스턴스에서만 일관됩니다.
 */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;

  private readonly users = new Map<string, User>();
  private readonly balances = new Map<string, CreditBalance>();
  private readonly transactions = new Map<string, CreditTransaction[]>();
  private readonly apiKeys = new Map<string, ApiKeyRecord & { hash: string }>();
  private readonly orders = new Map<string, Order>();
  private readonly webhookEvents = new Map<string, WebhookEventRecord>();
  private readonly jobs = new Map<string, ConversionJob>();
  private readonly signupBonusGiven = new Set<string>();

  async createUser(input: CreateUserInput = {}): Promise<User> {
    const email = input.email?.trim() || null;
    if (email) {
      const existing = await this.findUserByEmail(email);
      if (existing) return existing;
    }
    const user: User = {
      id: randomUUID(),
      email,
      displayName: input.displayName ?? null,
      createdAt: now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.email?.toLowerCase() === normalized) return user;
    }
    return null;
  }

  async getOrCreateUserByEmail(email: string, displayName?: string | null): Promise<User> {
    const existing = await this.findUserByEmail(email);
    if (existing) return existing;
    return this.createUser({ email, displayName });
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

  async checkHealth(): Promise<boolean> {
    return true;
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

export { hashApiKey };
