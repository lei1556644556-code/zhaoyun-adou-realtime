import { AccountPersistenceError, readablePersistenceError } from "./errors";
import type { CloudProgress, ProgressRecord, ProgressStore, StorageLike } from "./types";
import { SupabaseGatewayError, type SupabaseGateway } from "./SupabaseGateway";

const LOCAL_PROGRESS_PREFIX = "adou-local-development-progress-v1:";

function assertRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new AccountPersistenceError("PROGRESS_INVALID", "存档 revision 必须是非负整数");
  }
}

function assertProgress(progress: CloudProgress) {
  if (!progress || progress.version !== 1 || !Number.isFinite(progress.savedAt) || progress.savedAt < 0
    || ![null, "practice", "online"].includes(progress.activeMode)) {
    throw new AccountPersistenceError("PROGRESS_INVALID", "存档文档版本或基础字段无效");
  }
}

export class SupabaseProgressStore implements ProgressStore {
  readonly mode = "cloud" as const;

  constructor(private readonly gateway: SupabaseGateway) {}

  async load(accountId: string): Promise<ProgressRecord | null> {
    try {
      const row = await this.gateway.profile(accountId);
      if (!row) return null;
      assertRevision(row.progress_revision);
      assertProgress(row.progress);
      return {
        accountId,
        revision: row.progress_revision,
        updatedAt: row.updated_at,
        durability: "cloud",
        progress: row.progress,
      };
    } catch (error) {
      throw readablePersistenceError(error);
    }
  }

  async save(accountId: string, progress: CloudProgress, expectedRevision: number): Promise<ProgressRecord> {
    assertRevision(expectedRevision);
    assertProgress(progress);
    try {
      const row = await this.gateway.saveProgress(accountId, progress, expectedRevision);
      return {
        accountId,
        revision: row.saved_revision,
        updatedAt: row.saved_at,
        durability: "cloud",
        progress: row.saved_progress,
      };
    } catch (error) {
      if (error instanceof SupabaseGatewayError && error.code === "40001") {
        throw new AccountPersistenceError(
          "PROGRESS_CONFLICT",
          "云存档已在另一设备更新，请重新载入后再保存",
          { cause: error },
        );
      }
      if (error instanceof SupabaseGatewayError && ["22001", "22023"].includes(error.code ?? "")) {
        throw new AccountPersistenceError("PROGRESS_INVALID", "云存档文档不符合版本或大小限制", { cause: error });
      }
      if (error instanceof SupabaseGatewayError && error.code === "42501") {
        throw new AccountPersistenceError("AUTH_INVALID_CREDENTIALS", "当前账号无权写入这份云存档", { cause: error });
      }
      throw readablePersistenceError(error);
    }
  }
}

export class LocalDevelopmentProgressStore implements ProgressStore {
  readonly mode = "local-development" as const;

  constructor(
    private readonly storage: StorageLike,
    private readonly prefix = LOCAL_PROGRESS_PREFIX,
  ) {}

  async load(accountId: string): Promise<ProgressRecord | null> {
    try {
      const parsed = JSON.parse(this.storage.getItem(this.key(accountId)) ?? "null") as ProgressRecord | null;
      if (!parsed || parsed.accountId !== accountId || parsed.durability !== "device-only") return null;
      assertRevision(parsed.revision);
      assertProgress(parsed.progress);
      if (typeof parsed.updatedAt !== "string") return null;
      return parsed;
    } catch (error) {
      if (error instanceof AccountPersistenceError) throw error;
      return null;
    }
  }

  async save(accountId: string, progress: CloudProgress, expectedRevision: number): Promise<ProgressRecord> {
    assertRevision(expectedRevision);
    assertProgress(progress);
    const current = await this.load(accountId);
    const actualRevision = current?.revision ?? 0;
    if (actualRevision !== expectedRevision) {
      throw new AccountPersistenceError("PROGRESS_CONFLICT", "本地存档已变化，请重新载入后再保存");
    }
    const next: ProgressRecord = {
      accountId,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
      durability: "device-only",
      progress,
    };
    this.storage.setItem(this.key(accountId), JSON.stringify(next));
    return next;
  }

  private key(accountId: string) {
    return `${this.prefix}${encodeURIComponent(accountId)}`;
  }
}
