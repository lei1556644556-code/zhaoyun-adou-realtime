import { describe, expect, it } from "vitest";

import { LocalDevelopmentAccountStore, normalizeUsername, usernameEmail } from "../src/auth/AccountStore";
import { AccountPersistenceError } from "../src/auth/errors";
import { resolvePersistenceConfiguration } from "../src/auth/persistence";
import type { StorageLike } from "../src/auth/types";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("account configuration", () => {
  it("uses an explicit device-only mode when cloud variables are absent", () => {
    expect(resolvePersistenceConfiguration({})).toEqual({
      mode: "local-development",
      reason: expect.stringContaining("仅可使用明确标记"),
    });
  });

  it("rejects a partial or placeholder cloud configuration", () => {
    expect(() => resolvePersistenceConfiguration({ VITE_SUPABASE_URL: "https://project.supabase.co" }))
      .toThrowError(AccountPersistenceError);
    expect(() => resolvePersistenceConfiguration({
      VITE_SUPABASE_URL: "https://project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "your_supabase_publishable_key",
    })).toThrowError(/必须同时设置/);
  });

  it("accepts a complete cloud configuration", () => {
    expect(resolvePersistenceConfiguration({
      VITE_SUPABASE_URL: "https://project.supabase.co/",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
    })).toEqual({
      mode: "cloud",
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_test-value",
    });
  });
});
describe("account identity", () => {
  it("normalizes equivalent user names to the same synthetic Auth email", async () => {
    const first = normalizeUsername("  ＡdOu  ");
    const second = normalizeUsername("adou");
    expect(first).toBe(second);
    expect(await usernameEmail(first)).toBe(await usernameEmail(second));
  });

  it("never treats local development as password authentication or stores a password", async () => {
    const storage = new MemoryStorage();
    const store = new LocalDevelopmentAccountStore(storage);
    await expect(store.signIn({ username: "测试玩家", password: "secret-password" }))
      .rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
    expect([...storage.values.values()].join("\n")).not.toContain("secret-password");

    const identity = await store.enterLocalDevelopment("测试玩家");
    expect(identity.assurance).toBe("local-development");
    expect(await store.restore()).toEqual(identity);
    expect([...storage.values.values()].join("\n")).not.toMatch(/password|secret-password/i);
  });
});
