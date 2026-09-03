import type { Session } from "@supabase/supabase-js";

import { AccountPersistenceError, readablePersistenceError } from "./errors";
import { createPersistenceServices, type PersistenceServices } from "./persistence";
import type { AccountIdentity, CloudProgress, PlayerProfile, StorageLike } from "./types";

export type { AccountEconomy, OwnedProp, ShopOffer } from "../economy/types";
export type { CloudProgress, PlayerProfile } from "./types";
export { normalizeUsername, validateCredentials } from "./AccountStore";

function browserStorage(): StorageLike {
  if (typeof localStorage !== "undefined") return localStorage;
  throw new AccountPersistenceError("AUTH_CONFIGURATION", "当前运行环境没有可用的本地存储");
}

/**
 * Backward-compatible facade for the current composition root.
 * New code should depend on AccountStore and ProgressStore from createPersistenceServices instead.
 */
export class SupabaseService {
  readonly mode: PersistenceServices["mode"];
  readonly statusLabel: PersistenceServices["statusLabel"];
  private readonly services: PersistenceServices;

  constructor(connection: { url: string; publishableKey: string }, storage: StorageLike = browserStorage()) {
    this.services = createPersistenceServices({
      environment: {
        VITE_SUPABASE_URL: connection.url,
        VITE_SUPABASE_PUBLISHABLE_KEY: connection.publishableKey,
      },
      storage,
    });
    this.mode = this.services.mode;
    this.statusLabel = this.services.statusLabel;
  }

  async session(): Promise<Session | null> {
    if (this.services.mode === "local-development") return null;
    try {
      const result = await this.services.client.auth.getSession();
      if (result.error) throw result.error;
      if (!result.data.session) return null;
      const verified = await this.services.client.auth.getUser();
      if (verified.error) throw verified.error;
      return verified.data.user?.id === result.data.session.user.id ? result.data.session : null;
    } catch (error) {
      throw readablePersistenceError(error);
    }
  }

  async signUp(username: string, password: string) {
    const services = this.cloudServices();
    const identity = await services.accountStore.signUp({ username, password });
    return this.profile(identity);
  }

  async signIn(username: string, password: string) {
    const services = this.cloudServices();
    const identity = await services.accountStore.signIn({ username, password });
    return this.profile(identity);
  }

  /** Explicit, password-free entry point. It must be labelled as device-only by the consumer. */
  async enterLocalDevelopment(username: string) {
    if (this.services.mode !== "local-development") {
      throw new AccountPersistenceError("AUTH_CONFIGURATION", "云端已配置，不能进入本地开发身份");
    }
    const identity = await this.services.accountStore.enterLocalDevelopment(username);
    return this.profile(identity);
  }

  async signOut() {
    await this.services.accountStore.signOut();
  }

  async loadProfile(session: Session): Promise<PlayerProfile> {
    const services = this.cloudServices();
    const identity = await services.accountStore.restore();
    if (!identity || identity.userId !== session.user.id) {
      throw new AccountPersistenceError("AUTH_INVALID_CREDENTIALS", "当前 Supabase 会话已失效，请重新登录");
    }
    return this.profile(identity);
  }

  async saveProgress(profile: PlayerProfile, progress: CloudProgress) {
    if (profile.assurance === "supabase" && this.services.mode !== "cloud") {
      throw new AccountPersistenceError("AUTH_CONFIGURATION", "云端账号不能写入本地开发存档");
    }
    if (profile.assurance === "local-development" && this.services.mode !== "local-development") {
      throw new AccountPersistenceError("AUTH_CONFIGURATION", "本地开发身份不能写入云端存档");
    }
    const saved = await this.services.progressStore.save(profile.userId, progress, profile.progressRevision);
    profile.progress = saved.progress;
    profile.progressRevision = saved.revision;
  }

  private async profile(identity: AccountIdentity): Promise<PlayerProfile> {
    const record = await this.services.progressStore.load(identity.userId);
    return {
      ...identity,
      progress: record?.progress ?? null,
      progressRevision: record?.revision ?? 0,
    };
  }

  private cloudServices(): Extract<PersistenceServices, { mode: "cloud" }> {
    if (this.services.mode !== "cloud") {
      throw new AccountPersistenceError(
        "AUTH_UNAVAILABLE",
        "未配置 Supabase，当前只能使用“本地开发模式 · 未认证 · 仅此设备”；请由集成入口显式调用 enterLocalDevelopment",
      );
    }
    return this.services;
  }
}
