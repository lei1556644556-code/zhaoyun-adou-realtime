import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

import type { CloudProgress } from "./types";

export interface ProfileRow {
  user_id: string;
  display_name: string;
  username_normalized: string;
  progress: CloudProgress;
  progress_revision: number;
  created_at: string;
  updated_at: string;
}

export interface SavedProgressRow {
  saved_progress: CloudProgress;
  saved_revision: number;
  saved_at: string;
}

export class SupabaseGatewayError extends Error {
  constructor(public readonly code: string | undefined, message: string) {
    super(message);
    this.name = "SupabaseGatewayError";
  }
}

function fail(error: { code?: string; message: string }): never {
  throw new SupabaseGatewayError(error.code, error.message);
}

export class SupabaseGateway {
  constructor(readonly client: SupabaseClient) {}

  async session(): Promise<Session | null> {
    const sessionResult = await this.client.auth.getSession();
    if (sessionResult.error) fail(sessionResult.error);
    if (!sessionResult.data.session) return null;
    const verified = await this.client.auth.getUser();
    if (verified.error) fail(verified.error);
    return verified.data.user?.id === sessionResult.data.session.user.id ? sessionResult.data.session : null;
  }

  async verifiedUser(): Promise<User | null> {
    const sessionResult = await this.client.auth.getSession();
    if (sessionResult.error) fail(sessionResult.error);
    if (!sessionResult.data.session) return null;
    const verified = await this.client.auth.getUser();
    if (verified.error) fail(verified.error);
    return verified.data.user;
  }

  async signUp(email: string, password: string, displayName: string, normalized: string) {
    const result = await this.client.auth.signUp({
      email,
      password,
      options: { data: { username: displayName, username_normalized: normalized } },
    });
    if (result.error) fail(result.error);
    return result.data;
  }

  async signIn(email: string, password: string) {
    const result = await this.client.auth.signInWithPassword({ email, password });
    if (result.error) fail(result.error);
    return result.data;
  }

  async signOut() {
    const result = await this.client.auth.signOut({ scope: "local" });
    if (result.error) fail(result.error);
  }

  async ensureProfile(userId: string, displayName: string, normalized: string) {
    const result = await this.client.from("zhaoyun_adou_profiles").upsert({
      user_id: userId,
      display_name: displayName,
      username_normalized: normalized,
    }, { onConflict: "user_id", ignoreDuplicates: true });
    if (result.error) fail(result.error);
  }

  async profile(userId: string): Promise<ProfileRow | null> {
    const result = await this.client
      .from("zhaoyun_adou_profiles")
      .select("user_id,display_name,username_normalized,progress,progress_revision,created_at,updated_at")
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>();
    if (result.error) fail(result.error);
    return result.data;
  }

  async saveProgress(accountId: string, progress: CloudProgress, expectedRevision: number): Promise<SavedProgressRow> {
    const result = await this.client.rpc("zhaoyun_adou_save_progress", {
      p_account_id: accountId,
      p_expected_revision: expectedRevision,
      p_progress: progress,
    }).single<SavedProgressRow>();
    if (result.error) fail(result.error);
    return result.data;
  }
}
