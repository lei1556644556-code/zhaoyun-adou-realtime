export type AccountErrorCode =
  | "AUTH_UNAVAILABLE"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_CONFIGURATION"
  | "AUTH_NETWORK"
  | "AUTH_RATE_LIMIT"
  | "AUTH_USERNAME_TAKEN"
  | "PROFILE_MIGRATION_REQUIRED"
  | "PROGRESS_CONFLICT"
  | "PROGRESS_INVALID";

export class AccountPersistenceError extends Error {
  constructor(
    public readonly code: AccountErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AccountPersistenceError";
  }
}
export function readablePersistenceError(error: unknown) {
  if (error instanceof AccountPersistenceError) return error;
  const source = error instanceof Error ? error : new Error(String(error));
  const message = source.message;
  if (/already registered|already exists|duplicate key/i.test(message)) {
    return new AccountPersistenceError("AUTH_USERNAME_TAKEN", "这个账号已被注册，请直接登录", { cause: source });
  }
  if (/invalid login credentials/i.test(message)) {
    return new AccountPersistenceError("AUTH_INVALID_CREDENTIALS", "账号或密码不正确", { cause: source });
  }
  if (/rate limit/i.test(message)) {
    return new AccountPersistenceError("AUTH_RATE_LIMIT", "操作太频繁，请稍后再试", { cause: source });
  }
  if (/fetch|network/i.test(message)) {
    return new AccountPersistenceError("AUTH_NETWORK", "无法连接云端，请检查网络后重试", { cause: source });
  }
  if (/zhaoyun_adou_profiles|schema cache|relation|progress_revision|zhaoyun_adou_save_progress/i.test(message)) {
    return new AccountPersistenceError(
      "PROFILE_MIGRATION_REQUIRED",
      "云存档结构尚未初始化，请执行项目内全部 Supabase 数据库迁移",
      { cause: source },
    );
  }
  return new AccountPersistenceError("AUTH_UNAVAILABLE", message, { cause: source });
}
