import type { MatchSnapshot, PropLoadout } from "@adou/shared";

import type { AccountEconomy } from "../economy/types";

export type PersistenceMode = "cloud" | "local-development";
export type AuthAssurance = "supabase" | "local-development";

export interface Credentials {
  username: string;
  password: string;
}
export interface AccountIdentity {
  userId: string;
  username: string;
  createdAt: string;
  assurance: AuthAssurance;
}

export interface AccountStore {
  readonly mode: PersistenceMode;
  restore(): Promise<AccountIdentity | null>;
  signUp(credentials: Credentials): Promise<AccountIdentity>;
  signIn(credentials: Credentials): Promise<AccountIdentity>;
  signOut(): Promise<void>;
}

export interface CloudProgress {
  version: 1;
  savedAt: number;
  activeMode: "practice" | "online" | null;
  practiceSnapshot?: MatchSnapshot;
  propLoadout?: PropLoadout;
  economy?: AccountEconomy;
}

export interface ProgressRecord<TProgress = CloudProgress> {
  accountId: string;
  revision: number;
  updatedAt: string;
  durability: "cloud" | "device-only";
  progress: TProgress;
}

export interface ProgressStore<TProgress = CloudProgress> {
  readonly mode: PersistenceMode;
  load(accountId: string): Promise<ProgressRecord<TProgress> | null>;
  save(accountId: string, progress: TProgress, expectedRevision: number): Promise<ProgressRecord<TProgress>>;
}

/** Compatibility shape for the existing composition root. New consumers should keep account and progress ports separate. */
export interface PlayerProfile extends AccountIdentity {
  progress: CloudProgress | null;
  progressRevision: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
