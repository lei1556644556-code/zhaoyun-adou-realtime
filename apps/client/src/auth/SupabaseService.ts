import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { MatchSnapshot, PropLoadout } from "@adou/shared";

const DEFAULT_SUPABASE_URL = "https://dkaabuxszrbnnrajnoaa.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_8UjZAjC-Ts2NiP8_NpmFdA_jv-CEzhd";
const PROFILE_TABLE = "zhaoyun_adou_profiles";

export interface OwnedProp {
  id: number;
  level: number;
}

export interface ShopOffer {
  id: number;
  /** 原包每个商品独立 10% 出现广告购买；网页版本直接免费领取。 */
  freeByAd: boolean;
  claimed?: boolean;
}

export interface AccountEconomy {
  dayKey: string;
  gold: number;
  stamina: number;
  winDay: number;
  loseDay: number;
  ownedProps: OwnedProp[];
  completedMatchKeys: string[];
  pendingResult?: { matchKey: string; won: boolean; baseReward: number };
  pendingShop?: { matchKey: string; offers: ShopOffer[]; lotteryIds: number[]; lotteryUsed: boolean; lotteryWinnerId?: number };
}

export interface CloudProgress {
  version: 1;
  savedAt: number;
  activeMode: "practice" | "online" | null;
  practiceSnapshot?: MatchSnapshot;
  propLoadout?: PropLoadout;
  economy?: AccountEconomy;
}

export interface PlayerProfile {
  userId: string;
  username: string;
  createdAt: string;
  progress: CloudProgress | null;
}

interface ProfileRow {
  user_id: string;
  display_name: string;
  username_normalized: string;
  progress: CloudProgress | null;
}

export function normalizeUsername(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export function validateCredentials(username: string, password: string) {
  const displayName = username.normalize("NFKC").trim();
  const normalized = normalizeUsername(displayName);
  if (displayName.length < 2 || displayName.length > 16) throw new Error("账号需为 2–16 个字符");
  if (!/^[\p{L}\p{N}_-]+$/u.test(displayName)) throw new Error("账号只能使用中英文字母、数字、下划线或短横线");
  if (password.length < 6 || password.length > 72) throw new Error("密码需为 6–72 个字符");
  return { displayName, normalized };
}

async function usernameEmail(normalized: string) {
  const bytes = new TextEncoder().encode(`zhaoyun-adou:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `u_${hex.slice(0, 48)}@accounts.zhaoyun-adou.game`;
}

function readableAuthError(message: string) {
  if (/already registered|already exists/i.test(message)) return "这个账号已被注册，请直接登录";
  if (/invalid login credentials/i.test(message)) return "账号或密码不正确";
  if (/password/i.test(message)) return "密码不符合要求，请至少输入 6 位";
  if (/rate limit/i.test(message)) return "操作太频繁，请稍后再试";
  if (/fetch|network/i.test(message)) return "无法连接云端，请检查网络后重试";
  return message;
}

export class SupabaseService {
  private client: SupabaseClient;

  constructor() {
    const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_KEY;
    this.client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  async session() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw new Error(readableAuthError(error.message));
    return data.session;
  }

  async signUp(username: string, password: string) {
    const { displayName, normalized } = validateCredentials(username, password);
    const email = await usernameEmail(normalized);
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: { username: displayName, username_normalized: normalized } },
    });
    if (error) throw new Error(readableAuthError(error.message));
    if (!data.session || !data.user) throw new Error("注册成功但未自动登录，请检查 Supabase 是否关闭了邮箱确认");
    await this.ensureProfile(data.session, displayName, normalized);
    return this.loadProfile(data.session);
  }

  async signIn(username: string, password: string) {
    const { displayName, normalized } = validateCredentials(username, password);
    const email = await usernameEmail(normalized);
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(readableAuthError(error?.message ?? "登录失败"));
    await this.ensureProfile(data.session, displayName, normalized);
    return this.loadProfile(data.session);
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) throw new Error(readableAuthError(error.message));
  }

  async loadProfile(session: Session): Promise<PlayerProfile> {
    const { data, error } = await this.client
      .from(PROFILE_TABLE)
      .select("user_id,display_name,username_normalized,progress")
      .eq("user_id", session.user.id)
      .maybeSingle<ProfileRow>();
    if (error) throw new Error(this.profileError(error.message));
    const metadataName = String(session.user.user_metadata.username ?? "玩家");
    return {
      userId: session.user.id,
      username: data?.display_name || metadataName,
      createdAt: session.user.created_at,
      progress: data?.progress ?? null,
    };
  }

  async saveProgress(profile: PlayerProfile, progress: CloudProgress) {
    const { error } = await this.client.from(PROFILE_TABLE).upsert({
      user_id: profile.userId,
      display_name: profile.username,
      username_normalized: normalizeUsername(profile.username),
      progress,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw new Error(this.profileError(error.message));
  }

  private async ensureProfile(session: Session, displayName: string, normalized: string) {
    const { error } = await this.client.from(PROFILE_TABLE).upsert({
      user_id: session.user.id,
      display_name: displayName,
      username_normalized: normalized,
      progress: { version: 1, savedAt: Date.now(), activeMode: null },
    }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw new Error(this.profileError(error.message));
  }

  private profileError(message: string) {
    if (/zhaoyun_adou_profiles|schema cache|relation/i.test(message)) return "云存档表尚未初始化，请先执行项目内的 Supabase 数据库迁移";
    if (/duplicate key/i.test(message)) return "这个账号已被注册，请换一个账号";
    return readableAuthError(message);
  }
}
