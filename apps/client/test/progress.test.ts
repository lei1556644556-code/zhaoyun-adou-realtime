import { describe, expect, it } from "vitest";

import { LocalDevelopmentProgressStore, SupabaseProgressStore } from "../src/auth/ProgressStore";
import { SupabaseGatewayError, type SupabaseGateway } from "../src/auth/SupabaseGateway";
import type { CloudProgress, StorageLike } from "../src/auth/types";
import { EconomyService, type EconomyRules } from "../src/economy/EconomyService";
import { PROPS } from "@adou/shared";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function progress(savedAt: number): CloudProgress {
  return { version: 1, savedAt, activeMode: null };
}

describe("LocalDevelopmentProgressStore", () => {
  it("isolates records by account and labels them device-only", async () => {
    const store = new LocalDevelopmentProgressStore(new MemoryStorage());
    const first = await store.save("local:a", progress(1), 0);
    await store.save("local:b", progress(2), 0);

    expect(first).toMatchObject({ accountId: "local:a", revision: 1, durability: "device-only" });
    expect((await store.load("local:a"))?.progress.savedAt).toBe(1);
    expect((await store.load("local:b"))?.progress.savedAt).toBe(2);
  });

  it("rejects stale saves instead of silently overwriting a newer revision", async () => {
    const store = new LocalDevelopmentProgressStore(new MemoryStorage());
    await store.save("local:a", progress(1), 0);
    await expect(store.save("local:a", progress(2), 0))
      .rejects.toMatchObject({ code: "PROGRESS_CONFLICT" });
    expect((await store.load("local:a"))?.progress.savedAt).toBe(1);
  });

  it("restores claimed reward and shop limits across a refresh", async () => {
    const rules: EconomyRules = {
      props: PROPS,
      timeZone: "Asia/Shanghai",
      initialStamina: 30,
      maxStamina: 30,
      winRewardGold: 20,
      lossRewardGold: 5,
      normalRewardMultiplier: 1,
      directOriginalAdRewardMultiplier: 2,
      shopOfferCount: 1,
      directOriginalAdOfferChance: 1,
      lotteryCandidateCount: 2,
      completedMatchLimit: 50,
      outsideBattleEffects: { marchPill: { kind: "stamina", amount: 1 } },
    };
    const economyService = new EconomyService(rules, { next: () => 0 });
    const started = economyService.beginResult(economyService.fresh(new Date("2026-09-03T04:00:00Z")), "refresh-match", true);
    const claimed = economyService.claimResult(started.economy, "direct-original-ad");
    const offerClaimed = economyService.claimShopOffer(claimed, 0);
    const store = new LocalDevelopmentProgressStore(new MemoryStorage());
    await store.save("local:a", { version: 1, savedAt: 1, activeMode: null, economy: offerClaimed }, 0);

    const restoredDocument = (await store.load("local:a"))?.progress;
    const restored = economyService.normalize(restoredDocument?.economy, new Date("2026-09-03T05:00:00Z"));
    expect(restored.gold).toBe(40);
    expect(restored.completedMatchKeys).toEqual(["refresh-match"]);
    expect(restored.pendingShop?.offers[0]?.claimed).toBe(true);
    expect(() => economyService.claimShopOffer(restored, 0)).toThrowError(/已经领取/);
    expect(economyService.beginResult(restored, "refresh-match", true).created).toBe(false);
  });
});

describe("SupabaseProgressStore", () => {
  it("maps the database serialization failure to a reload-required conflict", async () => {
    const gateway = {
      saveProgress: async () => { throw new SupabaseGatewayError("40001", "progress revision conflict"); },
    } as unknown as SupabaseGateway;
    const store = new SupabaseProgressStore(gateway);
    await expect(store.save("00000000-0000-0000-0000-000000000001", progress(1), 0))
      .rejects.toMatchObject({ code: "PROGRESS_CONFLICT" });
  });

  it("maps database document validation failures without reporting a false network error", async () => {
    const gateway = {
      saveProgress: async () => { throw new SupabaseGatewayError("22001", "progress document exceeds 1 MiB"); },
    } as unknown as SupabaseGateway;
    const store = new SupabaseProgressStore(gateway);
    await expect(store.save("00000000-0000-0000-0000-000000000001", progress(1), 0))
      .rejects.toMatchObject({ code: "PROGRESS_INVALID" });
  });
});
