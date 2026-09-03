import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { LocalDevelopmentAccountStore, SupabaseAccountStore } from "./AccountStore";
import { AccountPersistenceError } from "./errors";
import { LocalDevelopmentProgressStore, SupabaseProgressStore } from "./ProgressStore";
import { SupabaseGateway } from "./SupabaseGateway";
import type { StorageLike } from "./types";

export interface PersistenceEnvironment {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

export type PersistenceConfiguration =
  | { mode: "cloud"; url: string; publishableKey: string }
  | { mode: "local-development"; reason: string };

function meaningful(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized && !/your_|你的|example/i.test(normalized) ? normalized : null;
}

export function resolvePersistenceConfiguration(environment: PersistenceEnvironment): PersistenceConfiguration {
  const url = meaningful(environment.VITE_SUPABASE_URL);
  const publishableKey = meaningful(environment.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!url && !publishableKey) {
    return {
      mode: "local-development",
      reason: "未配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY；仅可使用明确标记的设备内开发存档",
    };
  }
  if (!url || !publishableKey) {
    throw new AccountPersistenceError(
      "AUTH_CONFIGURATION",
      "Supabase 配置不完整：VITE_SUPABASE_URL 与 VITE_SUPABASE_PUBLISHABLE_KEY 必须同时设置",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new AccountPersistenceError("AUTH_CONFIGURATION", "VITE_SUPABASE_URL 不是有效 URL", { cause: error });
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new AccountPersistenceError("AUTH_CONFIGURATION", "Supabase 云端地址必须使用 HTTPS", undefined);
  }
  return { mode: "cloud", url: parsed.toString().replace(/\/$/, ""), publishableKey };
}

export type PersistenceServices =
  | {
    mode: "cloud";
    statusLabel: "云端账号与存档";
    accountStore: SupabaseAccountStore;
    progressStore: SupabaseProgressStore;
    client: SupabaseClient;
  }
  | {
    mode: "local-development";
    statusLabel: "本地开发模式 · 未认证 · 仅此设备";
    reason: string;
    accountStore: LocalDevelopmentAccountStore;
    progressStore: LocalDevelopmentProgressStore;
  };

export function createPersistenceServices(options: {
  environment: PersistenceEnvironment;
  storage: StorageLike;
  client?: SupabaseClient;
}): PersistenceServices {
  const config = resolvePersistenceConfiguration(options.environment);
  if (config.mode === "local-development") {
    return {
      mode: config.mode,
      statusLabel: "本地开发模式 · 未认证 · 仅此设备",
      reason: config.reason,
      accountStore: new LocalDevelopmentAccountStore(options.storage),
      progressStore: new LocalDevelopmentProgressStore(options.storage),
    };
  }
  const client = options.client ?? createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const gateway = new SupabaseGateway(client);
  return {
    mode: config.mode,
    statusLabel: "云端账号与存档",
    accountStore: new SupabaseAccountStore(gateway),
    progressStore: new SupabaseProgressStore(gateway),
    client,
  };
}
