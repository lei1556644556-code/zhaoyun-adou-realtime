import { describe, expect, it } from "vitest";
import {
  ACTIVE_PROP_IDS,
  ATTACK_RANGE_RULES,
  BOSS_CHANCES,
  BOSS_CONFIGS,
  BOSS_ENEMY_SPEED_PX_PER_SEC,
  BOSS_MILESTONES,
  DIFFICULTY_CURVES,
  DIFFICULTY_WEIGHTS,
  EARLY_ACCOUNT_SHOVEL_WEIGHT,
  EARLY_ACCOUNT_TOKEN_POOL_WEIGHT,
  GAME_CONFIG,
  GENERAL_LEVEL_ATTACK,
  GENERAL_LEVEL_SPEED,
  GENERALS,
  HERO_PAIRS,
  LEVEL_ATTACK,
  LEVEL_SPEED,
  MAP_LAYOUTS,
  MERGE_RULES,
  PASSIVE_PROP_IDS,
  PROP_ACQUISITION_RULES,
  PROP_EFFECTS,
  PROP_RARITY_COLORS,
  PROP_RARITY_NAMES,
  PROPS,
  RECRUITMENT_RULES,
  RULE_EVIDENCE_SOURCES,
  RULE_PROVENANCE,
  RULES_CONFIG_1_0_9,
  SOLDIER_LEVEL_ATTACK,
  SOLDIER_LEVEL_SPEED,
  SOLDIERS,
  TOKEN_POOL,
  TOKEN_POOL_BASE_WEIGHT,
  TOKEN_POOL_SHOVEL_WEIGHT,
  WAVES,
} from "../src";

function stableFingerprint(value: unknown) {
  let hash = 0xcbf29ce484222325n;
  for (const character of JSON.stringify(value)) {
    hash ^= BigInt(character.charCodeAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

describe("1.0.9 versioned rules config", () => {
  it("publishes one versioned entry point and honest evidence metadata", () => {
    expect(RULES_CONFIG_1_0_9.rulesetVersion).toBe("1.0.9");
    expect(RULES_CONFIG_1_0_9.schemaVersion).toBe("1.2.0");
    expect(RULES_CONFIG_1_0_9.evidence).toBe(RULE_EVIDENCE_SOURCES);
    expect(RULES_CONFIG_1_0_9.provenance).toBe(RULE_PROVENANCE);
    expect(RULE_EVIDENCE_SOURCES.originalPackage.artifactPath).toBeNull();
    expect(RULE_EVIDENCE_SOURCES.originalPackage.repositoryReproducible).toBe(false);
    expect(Object.values(RULE_PROVENANCE).every((entry) => entry.evidenceRefs.length > 0)).toBe(true);
    expect(Object.values(RULE_PROVENANCE).some((entry) => entry.status === "pending-original-verification")).toBe(true);
    expect(Object.values(RULE_PROVENANCE).some((entry) => entry.status === "project-adaptation")).toBe(true);
    expect(Object.fromEntries(Object.entries(RULE_PROVENANCE).map(([key, value]) => [key, value.status]))).toEqual({
      openingAndBoard: "package-recorded",
      recruitmentPool: "package-recorded",
      earlyAccountShovelBonus: "package-recorded",
      campAndRecycle: "pending-original-verification",
      mergePairs: "package-recorded",
      twoCellGeneralAndSplit: "pending-original-verification",
      soldierAndGeneralStats: "package-recorded",
      attackCollision: "package-recorded",
      wavesAndBossChance: "package-recorded",
      mapLayouts: "package-recorded",
      mapPathInterpolation: "project-adaptation",
      propsCatalog: "package-recorded",
      propRuntimeDetails: "pending-original-verification",
      propAcquisition: "pending-original-verification",
      directGrantInsteadOfAds: "project-adaptation",
      authoritativeTickRate: "project-adaptation",
    });
  });

  it("locks every current battle constant, including package-recorded cadence values", () => {
    expect(GAME_CONFIG).toEqual({
      protocolVersion: "0.3.0",
      columns: 8,
      rows: 10,
      designWidth: 640,
      designHeight: 1386,
      mapTop: 200,
      cellSize: 80,
      reserveSize: 5,
      baseHp: 3,
      maxWaves: 20,
      startBuns: 20,
      recruitBase: 10,
      recruitStep: 2,
      normalKillBuns: 1,
      bossKillBuns: 10,
      hpLostBuns: 10,
      prepareMs: 10_000,
      spawnMs: 1_500,
      interwaveMs: 5_000,
      tickHz: 10,
    });
  });

  it("derives the 108 base pool and 13/110 early-account shovel probability", () => {
    expect(TOKEN_POOL).toEqual([
      ["刀", 21], ["弓", 19], ["枪", 18], ["骑", 17], ["铲子", 11],
      ["赵", 2], ["云", 1], ["张", 2], ["飞", 1], ["马", 2], ["超", 1],
      ["关", 1], ["羽", 1], ["平", 1], ["兴", 1], ["黄", 2], ["忠", 1],
      ["苞", 1], ["翼", 1], ["盖", 1], ["祖", 1], ["刘", 1], ["备", 1],
    ]);
    expect(TOKEN_POOL_BASE_WEIGHT).toBe(108);
    expect(RECRUITMENT_RULES.baseWeightTotal).toBe(108);
    expect(TOKEN_POOL_SHOVEL_WEIGHT).toBe(11);
    expect(EARLY_ACCOUNT_SHOVEL_WEIGHT).toBe(13);
    expect(EARLY_ACCOUNT_TOKEN_POOL_WEIGHT).toBe(110);
    expect(EARLY_ACCOUNT_SHOVEL_WEIGHT / EARLY_ACCOUNT_TOKEN_POOL_WEIGHT).toBeCloseTo(13 / 110, 12);
    expect(RECRUITMENT_RULES.drawsPerRecruit).toBe(5);
    expect(RECRUITMENT_RULES.drawMode).toBe("persistent-pool; soldiers/shovel-with-replacement; general-names-without-replacement");
    expect(RECRUITMENT_RULES.earlyAccount).toMatchObject({
      eligibilityDailyMatches: 3,
      bonusFormula: "floor(baseShovelWeight/5)",
    });
    expect(RULE_PROVENANCE.earlyAccountShovelBonus.status).toBe("package-recorded");
  });

  it("freezes attack range, attack speed, and merge tables without prose parsing", () => {
    expect(SOLDIERS).toEqual({
      刀: { attack: 3, intervalMs: 800, range: 1.5, form: "单体", target: "最近敌人", maxLevel: 5 },
      弓: { attack: 2, intervalMs: 800, range: 3.5, form: "单体", target: "最接近终点", maxLevel: 5 },
      枪: { attack: 2, intervalMs: 800, range: 2.5, form: "贯穿", target: "最近敌人", maxLevel: 5 },
      骑: { attack: 2, intervalMs: 800, range: 2, form: "范围", target: "最近敌人", maxLevel: 5 },
    });
    expect(SOLDIER_LEVEL_ATTACK).toEqual([1, 1.5, 2.1, 2.73, 3.4125]);
    expect(SOLDIER_LEVEL_SPEED).toEqual([1, 1.5, 2.1, 2.73, 3.4125]);
    expect(GENERAL_LEVEL_ATTACK).toEqual([1, 1.5, 2.1, 2.73, 3.276]);
    expect(GENERAL_LEVEL_SPEED).toEqual([1, 1.3, 1.56, 1.794, 1.9734]);
    expect(LEVEL_ATTACK).toBe(GENERAL_LEVEL_ATTACK);
    expect(LEVEL_SPEED).toBe(GENERAL_LEVEL_SPEED);
    expect(ATTACK_RANGE_RULES).toMatchObject({ originalCellPx: 80, radiusReductionPx: 1, boundaryInclusive: true });
    expect(Object.keys(GENERALS)).toHaveLength(12);
    expect(Object.entries(GENERALS).map(([name, value]) => [
      name, value.weapon, value.attack, value.intervalMs, value.range, value.maxLevel,
    ])).toEqual([
      ["赵云", "枪", 2, 800, 2.5, 5],
      ["张飞", "枪", 10, 1_000, 2.5, 5],
      ["马超", "枪", 10, 1_000, 2.5, 5],
      ["关羽", "刀", 20, 1_000, 2.5, 5],
      ["黄忠", "弓", 6, 800, 4.5, 5],
      ["关平", "刀", 3, 1_000, 2.5, 3],
      ["关兴", "刀", 7, 1_000, 2.5, 3],
      ["张苞", "枪", 7, 1_000, 2.5, 3],
      ["张翼", "骑/剑", 7, 1_000, 2.5, 3],
      ["黄盖", "骑/剑", 8, 1_000, 2.5, 3],
      ["刘备", "骑/剑", 10, 800, 2.5, 5],
      ["黄祖", "弓", 6, 800, 3.5, 3],
    ]);
    expect(new Set(Object.values(HERO_PAIRS))).toEqual(new Set(Object.keys(GENERALS)));
    expect(HERO_PAIRS["赵+云"]).toBe("赵云");
    expect(HERO_PAIRS["云+赵"]).toBe("赵云");
    expect(Object.keys(HERO_PAIRS)).toHaveLength(24);
    for (const name of Object.keys(GENERALS)) {
      const [first, second] = [...name];
      expect(HERO_PAIRS[`${first}+${second}`]).toBe(name);
      expect(HERO_PAIRS[`${second}+${first}`]).toBe(name);
    }
    expect(stableFingerprint(GENERALS)).toBe("3906a692d669202b");
    expect(MERGE_RULES.generals).toMatchObject({
      adjacency: "horizontal",
      trigger: "automatic-after-board-placement-or-move",
      dissolveWhenPartsSeparate: true,
    });
  });

  it("keeps all prop rows, effect rows, slot ids, rarity labels, and acquisition rules aligned", () => {
    expect(PROPS.map((prop) => prop.id)).toEqual(Array.from({ length: 25 }, (_, id) => id));
    expect(PROPS.map((prop) => [
      prop.id, prop.price, prop.cooldownMs, prop.rarity, prop.target, prop.ja ?? null, prop.ha ?? null,
    ])).toEqual([
      [0, 999, 0, 3, "supply", null, null],
      [1, 999, 0, 3, "supply", null, null],
      [2, 50, 30_000, 2, "own-unit", 10, 12],
      [3, 60, 65_000, 2, "own-unit", 8, 8],
      [4, 90, 55_000, 3, "own-unit", 5, 3],
      [5, 50, 90_000, 1, "self", 10, 12],
      [6, 30, 60_000, 0, "own-unit", 20, 25],
      [7, 30, 90_000, 0, "enemy-area", 20, 25],
      [8, 35, 50_000, 0, "road-cell", 15, 20],
      [9, 50, 55_000, 1, "road-cell", 10, 12],
      [10, 80, 90_000, 2, "own-unit", 6, 4],
      [11, 80, -1, 2, "passive", 6, 4],
      [12, 90, -1, 2, "passive", 5, 3],
      [13, 90, -1, 2, "passive", 8, 8],
      [14, 60, -1, 1, "passive", 8, 8],
      [15, 90, -1, 2, "passive", 5, 3],
      [16, 50, -1, 0, "passive", 10, 12],
      [17, 40, -1, 0, "passive", 12, 15],
      [18, 40, -1, 0, "passive", 12, 15],
      [19, 120, -1, 3, "passive", 3, 1],
      [20, 150, -1, 3, "passive", 2, 1],
      [21, 150, 0, 3, "reserve", 2, 1],
      [22, 100, -1, 1, "passive", 8, 5],
      [23, 40, 0, 0, "outside-battle", 12, 15],
      [24, 150, -1, 3, "passive", 2, 1],
    ]);
    expect(Object.keys(PROP_EFFECTS).map(Number).sort((a, b) => a - b)).toEqual(PROPS.map((prop) => prop.id));
    expect(ACTIVE_PROP_IDS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 21]);
    expect(PASSIVE_PROP_IDS).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24]);
    expect(PROP_RARITY_NAMES).toEqual(["稀有", "卓越", "史诗", "传说"]);
    expect(PROP_RARITY_COLORS).toEqual(["#95e45a", "#2dddff", "#D955FF", "#E99431"]);
    expect(stableFingerprint(PROPS)).toBe("11b0a63193478084");
    expect(PROP_EFFECTS[3].outcomes).toEqual([
      { levelMin: 1, levelMax: 2, upChance: 1, downChance: 0 },
      { levelMin: 3, levelMax: 3, upChance: 0.7, downChance: 0.3 },
      { levelMin: 4, levelMax: null, upChance: 0.6, downChance: 0.4 },
    ]);
    expect(PROP_EFFECTS[5].charges).toBe(10);
    expect(PROP_EFFECTS[6].eligibleUnitKinds).toEqual(["弓", "all-generals"]);
    expect(PROP_EFFECTS[9]).toMatchObject({ blastRadiusPx: 60, blastRadiusCells: 0.75, result: "instant-kill" });
    expect(PROP_EFFECTS[13]).toMatchObject({
      verification: "package-recorded",
      perNameIndependentCopyChance: 0.5,
      consumeDrawnNameFromPersistentPool: true,
      removeOneAdditionalMatchingCopyAfterBoost: true,
    });
    expect(PROP_EFFECTS[20]).toMatchObject({ cooldownMs: 300_000, lastRouteCells: 6, impactRadiusCells: 1 });
    expect(PROP_EFFECTS[23]).toMatchObject({ amount: 10, consumedImmediately: true });
    expect(PROP_EFFECTS[24].recordedRuntimeReward).toBeNull();

    for (const outcome of PROP_EFFECTS[3].outcomes) {
      expect(outcome.upChance + outcome.downChance).toBe(1);
    }
    expect(PROP_EFFECTS[5].outcomes.reduce((sum, outcome) => sum + outcome.chance, 0)).toBe(1);
    expect(PROP_EFFECTS[22].chanceByLevel.every((chance) => chance >= 0 && chance <= 1)).toBe(true);
    for (const effect of Object.values(PROP_EFFECTS)) {
      for (const [key, value] of Object.entries(effect)) {
        if ((key.endsWith("Chance") || key === "chance") && typeof value === "number") {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
    const recordedEffects = Object.fromEntries(
      Object.entries(PROP_EFFECTS).filter(([, effect]) => effect.verification === "package-recorded"),
    );
    expect(stableFingerprint(recordedEffects)).toBe("a2208652a5d540f3");

    expect(PROP_ACQUISITION_RULES.loadout).toMatchObject({ activeLimit: 2, passiveLimit: 6, duplicatesAllowed: false });
    expect(PROP_ACQUISITION_RULES.inBattleShovelSupply.webAdaptation).toEqual({
      directGrant: true,
      maxClaimsPerMatch: 1,
      maxShovels: 2,
      consumeClaimWhenReserveFull: false,
    });
    expect(PROP_ACQUISITION_RULES.settlement).toMatchObject({
      originalBaseCoins: { victory: 20, defeat: 5 },
      originalAdMultiplier: 2,
      webAdReplacement: "direct-double-claim",
    });
    expect(PROP_ACQUISITION_RULES.postMatchShop).toMatchObject({ offerCount: 3, perOfferOriginalAdChance: 0.1 });
    expect(PROP_ACQUISITION_RULES.postMatchShop.perOfferOriginalAdChance).toBeGreaterThanOrEqual(0);
    expect(PROP_ACQUISITION_RULES.postMatchShop.perOfferOriginalAdChance).toBeLessThanOrEqual(1);
    expect(PROP_ACQUISITION_RULES.roulette).toMatchObject({ candidateCount: 8, candidateWeightField: "ja", winnerWeightField: "ha" });
    expect(PROP_ACQUISITION_RULES.dailyReset.timeZone).toBe("Asia/Shanghai");
  });

  it("freezes all four maps, twenty waves, and boss milestone probabilities", () => {
    expect(MAP_LAYOUTS).toHaveLength(4);
    for (const map of MAP_LAYOUTS) {
      expect(map.cells).toHaveLength(8);
      expect(map.cells.every((column) => column.length === 10)).toBe(true);
    }
    expect(WAVES).toEqual([
      [10, 10], [11, 16], [12, 26], [13, 41], [15, 61], [16, 92], [18, 138], [19, 200],
      [21, 291], [24, 421], [26, 611], [29, 886], [31, 1_285], [35, 1_863], [38, 2_701],
      [42, 3_917], [46, 5_680], [51, 8_235], [56, 11_941], [61, 17_315],
    ]);
    expect(DIFFICULTY_CURVES).toEqual([
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1.1, 1.2, 1.3, 1.2, 1.3, 1.7, 2, 1, 1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1.5, 1, 1.8, 2, 1, 1, 2, 1, 1, 1.3, 1, 1, 1.4, 1, 1, 1.5, 1, 1],
    ]);
    expect(DIFFICULTY_WEIGHTS).toEqual([5, 2, 3]);
    const difficultyWeightTotal = DIFFICULTY_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
    expect(difficultyWeightTotal).toBe(10);
    expect(DIFFICULTY_WEIGHTS.map((weight) => weight / difficultyWeightTotal)).toEqual([0.5, 0.2, 0.3]);
    expect(BOSS_MILESTONES).toEqual([3, 6, 9, 12, 15, 18]);
    expect(BOSS_CHANCES).toEqual([0.1, 0.2, 0.3, 0.5, 0.9, 1]);
    expect(BOSS_ENEMY_SPEED_PX_PER_SEC).toBe(10);
    expect(BOSS_CONFIGS.map((boss) => boss.hpMultiplier)).toEqual([7, 10, 14, 7, 10, 14, 7, 10, 14, 7, 10, 14]);
    expect(BOSS_CONFIGS.map((boss) => boss.cooldownMs)).toEqual([8_000, 8_000, 10_000, 10_000, 3_000, 10_000, 8_000, 10_000, 10_000, 15_000, 8_000, 15_000]);
    expect(BOSS_CHANCES.every((chance) => chance >= 0 && chance <= 1)).toBe(true);
    expect(stableFingerprint(MAP_LAYOUTS)).toBe("eb1599cc2794e28e");
  });
});
