import { PROPS } from "@adou/shared";
import { describe, expect, it } from "vitest";

import { EconomyService, type EconomyRules } from "../src/economy/EconomyService";
import type { AccountEconomy } from "../src/economy/types";

const RULES: EconomyRules = {
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

const clock = new Date("2026-09-03T04:00:00.000Z");

describe("EconomyService", () => {
  it("resets day-scoped props and flows while retaining gold and stamina", () => {
    const service = new EconomyService(RULES, { next: () => 0 });
    const restored = service.normalize({
      dayKey: "2026-09-02",
      gold: 88,
      stamina: 9,
      winDay: 3,
      ownedProps: [{ id: 2, level: 1 }],
      completedMatchKeys: ["old"],
      pendingResult: { matchKey: "old", won: true, baseReward: 9999 },
    }, clock);

    expect(restored).toEqual({
      dayKey: "2026-09-03",
      gold: 88,
      stamina: 9,
      winDay: 0,
      loseDay: 0,
      ownedProps: [],
      completedMatchKeys: [],
    });
  });

  it("directly grants the original ad multiplier once and persists the postgame state", () => {
    const service = new EconomyService(RULES, { next: () => 0 });
    const initial = service.fresh(clock);
    const started = service.beginResult(initial, "room:seed:0", true);
    expect(started.created).toBe(true);

    const claimed = service.claimResult(started.economy, "direct-original-ad");
    expect(claimed.gold).toBe(40);
    expect(claimed.winDay).toBe(1);
    expect(claimed.completedMatchKeys).toEqual(["room:seed:0"]);
    expect(claimed.pendingResult).toBeUndefined();
    expect(claimed.pendingShop?.offers).toHaveLength(1);
    expect(() => service.claimResult(claimed, "direct-original-ad")).toThrowError(/没有待领取/);
    expect(service.beginResult(claimed, "room:seed:0", true).created).toBe(false);
  });

  it("turns an original ad shop offer into one free claim, not unlimited claims", () => {
    const service = new EconomyService(RULES, { next: () => 0 });
    const started = service.beginResult(service.fresh(clock), "match-1", false);
    const shop = service.claimResult(started.economy, "normal");
    const beforeGold = shop.gold;
    const claimed = service.claimShopOffer(shop, 0);

    expect(claimed.gold).toBe(beforeGold);
    expect(claimed.pendingShop?.offers[0]?.claimed).toBe(true);
    expect(claimed.ownedProps).toContainEqual({ id: 2, level: 1 });
    expect(() => service.claimShopOffer(claimed, 0)).toThrowError(/已经领取/);
  });

  it("keeps the direct lottery limited to one draw per postgame shop", () => {
    const service = new EconomyService(RULES, { next: () => 0 });
    const started = service.beginResult(service.fresh(clock), "match-2", false);
    const shop = service.claimResult(started.economy, "normal");
    const drawn = service.drawLottery(shop);

    expect(drawn.pendingShop?.lotteryUsed).toBe(true);
    expect(drawn.pendingShop?.lotteryWinnerId).toBe(2);
    expect(() => service.drawLottery(drawn)).toThrowError(/已经使用/);
  });

  it("uses the rules catalog price for paid offers", () => {
    const paidRules = { ...RULES, directOriginalAdOfferChance: 0 };
    const service = new EconomyService(paidRules, { next: () => 0 });
    const economy = service.fresh(clock, { gold: 100 });
    const shop = service.claimResult(service.beginResult(economy, "match-paid", false).economy, "normal");
    const offerId = shop.pendingShop?.offers[0]?.id;
    const expectedPrice = PROPS.find((prop) => prop.id === offerId)?.price;
    const claimed = service.claimShopOffer(shop, 0);

    expect(offerId).toBe(2);
    expect(claimed.gold).toBe(100 + RULES.lossRewardGold - (expectedPrice ?? 0));
  });

  it("applies the configured runtime effect and consumes an outside-battle offer once", () => {
    const service = new EconomyService(RULES, { next: () => 0 });
    const economy: AccountEconomy = {
      ...service.fresh(clock, { stamina: 29 }),
      pendingShop: {
        matchKey: "match-pill",
        offers: [{ id: 23, freeByAd: true }],
        lotteryIds: [],
        lotteryUsed: false,
      },
    };
    const claimed = service.claimShopOffer(economy, 0);
    expect(claimed.stamina).toBe(30);
    expect(claimed.pendingShop?.offers[0]?.claimed).toBe(true);
    expect(() => service.claimShopOffer(claimed, 0)).toThrowError(/已经领取/);
  });
});
