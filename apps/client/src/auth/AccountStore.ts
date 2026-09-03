import type { User } from "@supabase/supabase-js";

import { AccountPersistenceError, readablePersistenceError } from "./errors";
import type { AccountIdentity, AccountStore, Credentials, StorageLike } from "./types";
import type { SupabaseGateway } from "./SupabaseGateway";

const LOCAL_ACCOUNT_KEY = "adou-local-development-account-v1";

export function normalizeUsername(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export function validateUsername(username: string) {
  const displayName = username.normalize("NFKC").trim();
  const normalized = normalizeUsername(displayName);
  if (displayName.length < 2 || displayName.length > 16) throw new Error("账号需为 2–16 个字符");
  if (!/^[\p{L}\p{N}_-]+$/u.test(displayName)) throw new Error("账号只能使用中英文字母、数字、下划线或短横线");
  return { displayName, normalized };
}

export function validateCredentials(username: string, password: string) {
  const account = validateUsername(username);
  if (password.length < 6 || password.length > 72) throw new Error("密码需为 6–72 个字符");
  return account;
}

export async function usernameEmail(normalized: string) {
  const bytes = new TextEncoder().encode(`zhaoyun-adou:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `u_${hex.slice(0, 48)}@accounts.zhaoyun-adou.game`;
}

function metadataName(user: User) {
  const candidate = typeof user.user_metadata.username === "string" ? user.user_metadata.username : "";
  try {
    return validateUsername(candidate);
  } catch {
    return validateUsername(`玩家${user.id.replaceAll("-", "").slice(0, 6)}`);
  }
}

export class SupabaseAccountStore implements AccountStore {
  readonly mode = "cloud" as const;

  constructor(private readonly gateway: SupabaseGateway) {}

  async restore() {
    try {
      const user = await this.gateway.verifiedUser();
      if (!user) return null;
      const name = metadataName(user);
      await this.gateway.ensureProfile(user.id, name.displayName, name.normalized);
      return await this.identity(user);
    } catch (error) {
      throw readablePersistenceError(error);
    }
  }

  async signUp(credentials: Credentials) {
    const { displayName, normalized } = validateCredentials(credentials.username, credentials.password);
    try {
      const data = await this.gateway.signUp(await usernameEmail(normalized), credentials.password, displayName, normalized);
      if (!data.session || !data.user) {
        throw new AccountPersistenceError(
          "AUTH_CONFIGURATION",
          "Supabase 已创建账号但未建立会话；用户名登录要求关闭邮箱确认",
        );
      }
      await this.gateway.ensureProfile(data.user.id, displayName, normalized);
      return await this.identity(data.user);
    } catch (error) {
      throw readablePersistenceError(error);
    }
  }

  async signIn(credentials: Credentials) {
    const { normalized } = validateCredentials(credentials.username, credentials.password);
    try {
      const data = await this.gateway.signIn(await usernameEmail(normalized), credentials.password);
      if (!data.user || !data.session) throw new AccountPersistenceError("AUTH_INVALID_CREDENTIALS", "账号或密码不正确");
      const name = metadataName(data.user);
      await this.gateway.ensureProfile(data.user.id, name.displayName, name.normalized);
      return await this.identity(data.user);
    } catch (error) {
      throw readablePersistenceError(error);
    }
  }

  async signOut() {
    try {
      await this.gateway.signOut();
    } catch (error) {
      throw readablePersistenceError(error);
    }
  }

  private async identity(user: User): Promise<AccountIdentity> {
    const row = await this.gateway.profile(user.id);
    if (!row) throw new AccountPersistenceError("PROFILE_MIGRATION_REQUIRED", "当前账号的云存档档案不存在");
    return {
      userId: user.id,
      username: row.display_name,
      createdAt: row.created_at || user.created_at,
      assurance: "supabase",
    };
  }
}

export class LocalDevelopmentAccountStore implements AccountStore {
  readonly mode = "local-development" as const;

  constructor(
    private readonly storage: StorageLike,
    private readonly storageKey = LOCAL_ACCOUNT_KEY,
  ) {}

  async restore(): Promise<AccountIdentity | null> {
    try {
      const parsed = JSON.parse(this.storage.getItem(this.storageKey) ?? "null") as Partial<AccountIdentity> | null;
      if (!parsed || parsed.assurance !== "local-development" || typeof parsed.userId !== "string"
        || typeof parsed.username !== "string" || typeof parsed.createdAt !== "string") return null;
      const { normalized } = validateUsername(parsed.username);
      if (parsed.userId !== `local-development:${encodeURIComponent(normalized)}`
        || !Number.isFinite(Date.parse(parsed.createdAt))) return null;
      return {
        userId: parsed.userId,
        username: parsed.username,
        createdAt: parsed.createdAt,
        assurance: "local-development",
      };
    } catch {
      return null;
    }
  }

  async enterLocalDevelopment(username: string): Promise<AccountIdentity> {
    const { displayName, normalized } = validateUsername(username);
    const existing = await this.restore();
    const identity: AccountIdentity = {
      userId: `local-development:${encodeURIComponent(normalized)}`,
      username: displayName,
      createdAt: existing?.userId === `local-development:${encodeURIComponent(normalized)}`
        ? existing.createdAt
        : new Date().toISOString(),
      assurance: "local-development",
    };
    this.storage.setItem(this.storageKey, JSON.stringify(identity));
    return identity;
  }

  async signUp(_credentials: Credentials): Promise<AccountIdentity> {
    throw new AccountPersistenceError(
      "AUTH_UNAVAILABLE",
      "本地开发模式不提供注册或密码认证；请显式调用 enterLocalDevelopment，且界面必须标明仅保存在此设备",
    );
  }

  async signIn(_credentials: Credentials): Promise<AccountIdentity> {
    throw new AccountPersistenceError(
      "AUTH_UNAVAILABLE",
      "本地开发模式不提供注册或密码认证；请显式调用 enterLocalDevelopment，且界面必须标明仅保存在此设备",
    );
  }

  async signOut() {
    this.storage.removeItem(this.storageKey);
  }
}
