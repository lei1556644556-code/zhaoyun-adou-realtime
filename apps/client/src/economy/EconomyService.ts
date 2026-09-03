import type { PropConfig } from "@adou/shared";

import type { AccountEconomy, OwnedProp, PendingMatchResult, PendingShop, ShopOffer } from "./types";

export type EconomyErrorCode =
  | "ALREADY_CLAIMED"
  | "INSUFFICIENT_GOLD"
  | "INVALID_REWARD_OPTION"
  | "NO_PENDING_FLOW"
  | "PENDING_FLOW_EXISTS"
  | "PROP_UNAVAILABLE"
  | "RULE_CONFIGURATION";

export class EconomyError extends Error {
  constructor(public readonly code: EconomyErrorCode, message: string) {
    super(message);
    this.name = "EconomyError";
  }
}

export interface EconomyRules {
  /** The rules module supplies the original 1.0.9 prop catalog; this service never copies item values. */
  props: readonly PropConfig[];
  timeZone: string;
  initialStamina: number;
  maxStamina: number;
  winRewardGold: number;
  lossRewardGold: number;
  normalRewardMultiplier: number;
  directOriginalAdRewardMultiplier: number;
  shopOfferCount: number;
  directOriginalAdOfferChance: number;
  lotteryCandidateCount: number;
  completedMatchLimit: number;
  /** Runtime-only effects whose true behavior cannot be derived from display copy. Keys are PropConfig.key values. */
  outsideBattleEffects: Readonly<Record<string, { kind: "stamina"; amount: number }>>;
}

export interface RandomSource {
  next(): number;
}

export interface ResultStart {
  economy: AccountEconomy;
  created: boolean;
}

export class EconomyService {
  private readonly byId: Map<number, PropConfig>;

  constructor(
    private readonly rules: EconomyRules,
    private readonly random: RandomSource = { next: () => Math.random() },
  ) {
    this.validateRules();
    this.byId = new Map(rules.props.map((prop) => [prop.id, prop]));
  }

  dayKey(at = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: this.rules.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  }

  fresh(at = new Date(), retained: { gold?: number; stamina?: number } = {}): AccountEconomy {
    return {
      dayKey: this.dayKey(at),
      gold: this.nonnegativeInt(retained.gold, 0),
      stamina: this.boundedInt(retained.stamina, this.rules.initialStamina, 0, this.rules.maxStamina),
      winDay: 0,
      loseDay: 0,
      ownedProps: [],
      completedMatchKeys: [],
    };
  }

  normalize(value: unknown, at = new Date()): AccountEconomy {
    const raw = this.record(value);
    const gold = this.nonnegativeInt(raw.gold, 0);
    const stamina = this.boundedInt(raw.stamina, this.rules.initialStamina, 0, this.rules.maxStamina);
    if (raw.dayKey !== this.dayKey(at)) return this.fresh(at, { gold, stamina });

    const ownedProps = this.normalizeOwnedProps(raw.ownedProps);
    const completedMatchKeys = this.stringList(raw.completedMatchKeys, this.rules.completedMatchLimit);
    const restoredResult = this.normalizePendingResult(raw.pendingResult);
    const pendingResult = restoredResult && !completedMatchKeys.includes(restoredResult.matchKey)
      ? restoredResult
      : undefined;
    const restoredShop = this.normalizePendingShop(raw.pendingShop);
    const pendingShop = restoredShop && completedMatchKeys.includes(restoredShop.matchKey)
      ? restoredShop
      : undefined;
    return {
      dayKey: this.dayKey(at),
      gold,
      stamina,
      winDay: this.nonnegativeInt(raw.winDay, 0),
      loseDay: this.nonnegativeInt(raw.loseDay, 0),
      ownedProps,
      completedMatchKeys,
      ...(pendingResult ? { pendingResult } : pendingShop ? { pendingShop } : {}),
    };
  }

  beginResult(economy: AccountEconomy, matchKey: string, won: boolean): ResultStart {
    this.assertMatchKey(matchKey);
    const state = this.clone(economy);
    if (state.completedMatchKeys.includes(matchKey)
      || state.pendingResult?.matchKey === matchKey
      || state.pendingShop?.matchKey === matchKey) return { economy: state, created: false };
    if (state.pendingResult || state.pendingShop) {
      throw new EconomyError("PENDING_FLOW_EXISTS", "必须先完成当前战后领取流程");
    }
    state.pendingResult = {
      matchKey,
      won,
      baseReward: won ? this.rules.winRewardGold : this.rules.lossRewardGold,
    };
    return { economy: state, created: true };
  }

  claimResult(economy: AccountEconomy, option: "normal" | "direct-original-ad") {
    const state = this.clone(economy);
    const result = state.pendingResult;
    if (!result) throw new EconomyError("NO_PENDING_FLOW", "当前没有待领取的战斗奖励");
    const multiplier = option === "normal"
      ? this.rules.normalRewardMultiplier
      : option === "direct-original-ad"
        ? this.rules.directOriginalAdRewardMultiplier
        : undefined;
    if (multiplier === undefined) throw new EconomyError("INVALID_REWARD_OPTION", "不支持的奖励领取方式");
    state.gold += result.baseReward * multiplier;
    if (result.won) state.winDay += 1;
    else state.loseDay += 1;
    state.completedMatchKeys = [...state.completedMatchKeys.filter((key) => key !== result.matchKey), result.matchKey]
      .slice(-this.rules.completedMatchLimit);
    state.pendingShop = this.createShop(state, result.matchKey);
    delete state.pendingResult;
    return state;
  }

  claimShopOffer(economy: AccountEconomy, offerIndex: number) {
    const state = this.clone(economy);
    const pending = state.pendingShop;
    if (!pending) throw new EconomyError("NO_PENDING_FLOW", "当前没有待领取的战后商店");
    const offer = pending.offers[offerIndex];
    if (!offer) throw new EconomyError("PROP_UNAVAILABLE", "商店道具不存在");
    if (offer.claimed) throw new EconomyError("ALREADY_CLAIMED", "这件商品已经领取");
    const prop = this.requireProp(offer.id);
    if (!this.canAcquire(state, prop)) throw new EconomyError("PROP_UNAVAILABLE", "这件道具当前不可获得");
    const price = this.price(state, prop);
    if (!offer.freeByAd && state.gold < price) throw new EconomyError("INSUFFICIENT_GOLD", "金币不足");
    if (!offer.freeByAd) state.gold -= price;
    this.grant(state, prop);
    offer.claimed = true;
    return state;
  }

  drawLottery(economy: AccountEconomy) {
    const state = this.clone(economy);
    const pending = state.pendingShop;
    if (!pending) throw new EconomyError("NO_PENDING_FLOW", "当前没有待领取的战后转盘");
    if (pending.lotteryUsed) throw new EconomyError("ALREADY_CLAIMED", "本次战后转盘已经使用");
    const available = pending.lotteryIds.filter((id) => {
      const prop = this.byId.get(id);
      return prop ? this.canAcquire(state, prop) : false;
    });
    if (!available.length) throw new EconomyError("PROP_UNAVAILABLE", "转盘中没有当前可获得的道具");
    const winner = this.weightedPick(state, available, "winner");
    if (winner === undefined) throw new EconomyError("RULE_CONFIGURATION", "转盘中奖权重为空");
    this.grant(state, this.requireProp(winner));
    pending.lotteryUsed = true;
    pending.lotteryWinnerId = winner;
    return state;
  }

  finishPostgame(economy: AccountEconomy) {
    const state = this.clone(economy);
    if (!state.pendingShop) throw new EconomyError("NO_PENDING_FLOW", "当前没有可结束的战后商店");
    delete state.pendingShop;
    return state;
  }

  private createShop(economy: AccountEconomy, matchKey: string): PendingShop {
    const offerCandidates = this.availableProps(economy);
    const offers: ShopOffer[] = [];
    while (offerCandidates.length && offers.length < this.rules.shopOfferCount) {
      const index = Math.floor(this.roll() * offerCandidates.length);
      const [prop] = offerCandidates.splice(index, 1);
      if (prop) offers.push({ id: prop.id, freeByAd: this.roll() < this.rules.directOriginalAdOfferChance });
    }

    const lotteryCandidates = this.availableProps(economy);
    const lotteryIds: number[] = [];
    while (lotteryCandidates.length && lotteryIds.length < this.rules.lotteryCandidateCount) {
      const id = this.weightedPick(economy, lotteryCandidates.map((prop) => prop.id), "pool");
      if (id === undefined) break;
      lotteryIds.push(id);
      lotteryCandidates.splice(lotteryCandidates.findIndex((prop) => prop.id === id), 1);
    }
    return { matchKey, offers, lotteryIds, lotteryUsed: false };
  }

  private availableProps(economy: AccountEconomy) {
    return this.rules.props.filter((prop) => prop.target !== "supply" && this.canAcquire(economy, prop));
  }

  private canAcquire(economy: AccountEconomy, prop: PropConfig) {
    if (prop.target === "supply") return false;
    if (prop.target === "outside-battle") {
      const effect = this.rules.outsideBattleEffects[prop.key];
      return Boolean(effect && effect.kind === "stamina" && economy.stamina < this.rules.maxStamina);
    }
    const owned = this.ownedLevel(economy, prop.id);
    return owned === 0 || owned < this.maxLevel(prop);
  }

  private grant(economy: AccountEconomy, prop: PropConfig) {
    if (prop.target === "outside-battle") {
      const effect = this.rules.outsideBattleEffects[prop.key];
      if (!effect) throw new EconomyError("RULE_CONFIGURATION", `规则模块未提供 ${prop.key} 的局外效果`);
      economy.stamina = Math.min(this.rules.maxStamina, economy.stamina + effect.amount);
      return;
    }
    const existing = economy.ownedProps.find((entry) => entry.id === prop.id);
    if (!existing) economy.ownedProps.push({ id: prop.id, level: 1 });
    else if (existing.level < this.maxLevel(prop)) existing.level += 1;
  }

  private weightedPick(economy: AccountEconomy, ids: readonly number[], kind: "pool" | "winner") {
    const weighted = ids.map((id) => ({ id, weight: this.weight(economy, this.requireProp(id), kind) }));
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) return undefined;
    let cursor = this.roll() * total;
    for (const item of weighted) {
      cursor -= item.weight;
      if (cursor < 0) return item.id;
    }
    return weighted.at(-1)?.id;
  }

  private weight(economy: AccountEconomy, prop: PropConfig, kind: "pool" | "winner") {
    const level = this.ownedLevel(economy, prop.id);
    const upgraded = kind === "pool" ? prop.upgradeJa?.[level] : prop.upgradeHa?.[level];
    return Math.max(0, upgraded ?? (kind === "pool" ? prop.ja : prop.ha) ?? 0);
  }

  private price(economy: AccountEconomy, prop: PropConfig) {
    const level = this.ownedLevel(economy, prop.id);
    return Math.max(0, prop.upgradePrices?.[level] ?? prop.price);
  }

  private normalizeOwnedProps(value: unknown): OwnedProp[] {
    if (!Array.isArray(value)) return [];
    const result: OwnedProp[] = [];
    for (const entry of value) {
      const row = this.record(entry);
      const id = Number(row.id);
      const prop = this.byId.get(id);
      if (!prop || prop.target === "supply" || prop.target === "outside-battle" || result.some((item) => item.id === id)) continue;
      result.push({ id, level: this.boundedInt(row.level, 1, 1, this.maxLevel(prop)) });
    }
    return result;
  }

  private normalizePendingResult(value: unknown): PendingMatchResult | undefined {
    const row = this.record(value);
    if (!this.validMatchKey(row.matchKey) || typeof row.won !== "boolean") return undefined;
    return {
      matchKey: row.matchKey,
      won: row.won,
      baseReward: row.won ? this.rules.winRewardGold : this.rules.lossRewardGold,
    };
  }

  private normalizePendingShop(value: unknown): PendingShop | undefined {
    const row = this.record(value);
    if (!this.validMatchKey(row.matchKey)) return undefined;
    const seenOffers = new Set<number>();
    const offers = (Array.isArray(row.offers) ? row.offers : []).flatMap((entry): ShopOffer[] => {
      const offer = this.record(entry);
      const id = Number(offer.id);
      const prop = this.byId.get(id);
      if (!prop || prop.target === "supply" || seenOffers.has(id)) return [];
      seenOffers.add(id);
      return [{ id, freeByAd: offer.freeByAd === true, ...(offer.claimed === true ? { claimed: true } : {}) }];
    }).slice(0, this.rules.shopOfferCount);
    const lotteryIds = [...new Set((Array.isArray(row.lotteryIds) ? row.lotteryIds : [])
      .map(Number).filter((id) => this.byId.get(id)?.target !== "supply"))]
      .slice(0, this.rules.lotteryCandidateCount);
    const lotteryUsed = row.lotteryUsed === true;
    const lotteryWinnerId = Number(row.lotteryWinnerId);
    return {
      matchKey: row.matchKey,
      offers,
      lotteryIds,
      lotteryUsed,
      ...(lotteryUsed && lotteryIds.includes(lotteryWinnerId) ? { lotteryWinnerId } : {}),
    };
  }

  private validateRules() {
    const integers = [
      this.rules.initialStamina,
      this.rules.maxStamina,
      this.rules.winRewardGold,
      this.rules.lossRewardGold,
      this.rules.normalRewardMultiplier,
      this.rules.directOriginalAdRewardMultiplier,
      this.rules.shopOfferCount,
      this.rules.lotteryCandidateCount,
      this.rules.completedMatchLimit,
    ];
    if (integers.some((value) => !Number.isSafeInteger(value) || value < 0)
      || this.rules.initialStamina > this.rules.maxStamina
      || !Number.isFinite(this.rules.directOriginalAdOfferChance)
      || this.rules.directOriginalAdOfferChance < 0
      || this.rules.directOriginalAdOfferChance > 1
      || !this.rules.timeZone
      || new Set(this.rules.props.map((prop) => prop.id)).size !== this.rules.props.length
      || Object.values(this.rules.outsideBattleEffects).some((effect) => effect.kind !== "stamina"
        || !Number.isSafeInteger(effect.amount) || effect.amount <= 0)) {
      throw new EconomyError("RULE_CONFIGURATION", "经济规则配置无效或包含重复道具 ID");
    }
  }

  private maxLevel(prop: PropConfig) {
    return Math.max(1, prop.levels?.length ?? 1);
  }

  private ownedLevel(economy: AccountEconomy, id: number) {
    return economy.ownedProps.find((entry) => entry.id === id)?.level ?? 0;
  }

  private requireProp(id: number) {
    const prop = this.byId.get(id);
    if (!prop) throw new EconomyError("PROP_UNAVAILABLE", `未知道具 ID：${id}`);
    return prop;
  }

  private roll() {
    const value = this.random.next();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new EconomyError("RULE_CONFIGURATION", "随机源必须返回 [0, 1) 内的有限数值");
    }
    return value;
  }

  private clone(economy: AccountEconomy): AccountEconomy {
    return structuredClone(economy);
  }

  private record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private nonnegativeInt(value: unknown, fallback: number) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
  }

  private boundedInt(value: unknown, fallback: number, min: number, max: number) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.floor(numeric))) : fallback;
  }

  private stringList(value: unknown, limit: number) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((entry): entry is string => this.validMatchKey(entry)))].slice(-limit);
  }

  private assertMatchKey(value: string): asserts value is string {
    if (!this.validMatchKey(value)) throw new EconomyError("PROP_UNAVAILABLE", "对局标识无效");
  }

  private validMatchKey(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 256;
  }
}
