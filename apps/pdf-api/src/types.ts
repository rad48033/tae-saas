import type { ApiKeyRecord, User } from "@tae/db";

export type AppEnv = {
  Variables: {
    requestId: string;
    user: User;
    apiKey: ApiKeyRecord;
    startedAt: number;
  };
};
