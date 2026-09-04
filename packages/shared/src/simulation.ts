import {
  ACTIVE_PROP_IDS, BATTLE_BUFFS, BATTLE_BUFF_DROP, BOSS_CHANCES, BOSS_CONFIGS, BOSS_ENEMY_SPEED_PX_PER_SEC, BOSS_MILESTONES,
  DIFFICULTY_CURVES, DIFFICULTY_WEIGHTS, EARLY_ACCOUNT_SHOVEL_BONUS, GAME_CONFIG,
  GENERAL_EXPERIENCE, GENERAL_LEVEL_ATTACK, GENERAL_LEVEL_SPEED, GENERALS, GENERAL_SKILLS, HERO_PAIRS, INTRO_ROUND_HP_MULTIPLIERS,
  MAP_LAYOUTS, NORMAL_ENEMY_SPEED_PX_PER_SEC, PASSIVE_PROP_IDS, PROPS, SOLDIER_LEVEL_ATTACK,
  RULESET_VERSION, RULES_CONFIG_SCHEMA_VERSION, SOLDIER_LEVEL_SPEED, SOLDIERS, TOKEN_POOL, WAVES,
  cellCode, cellCoords, initialOpenCells,
} from "./config";
import { MATCH_SNAPSHOT_VERSION } from "./types";
import type {
  BattleEvent, BattleEventPayload, CommandEnvelope, CommandErrorCode, CommandFailure, CommandResult, GameCommand,
  BattleFieldEffectState, EnemyState, GeneralSkillName, MatchSnapshot, MatchSnapshotInput, PendingGeneralImpactState, PlayerBattleState, PlayerPropState,
  PlayerSlot, PropLoadout, ReserveItem, UnitState, ZhaoPhantomState,
} from "./types";
import type { ActivePropId, BattleBuffKind, PassivePropId, SoldierKind } from "./config";

export interface Rng { next(): number; }

// Idempotency only needs to cover commands that may still be retried by a
// connected client. Bounding the ledger keeps long matches and their
// Supabase checkpoints from growing with every drag and recruit forever.
const ACCEPTED_COMMAND_HISTORY_LIMIT = 256;
const SMOKE_CROSS_RANGE_CELLS = BATTLE_BUFFS.find((buff) => buff.kind === "smoke")?.crossRangeCells ?? 2;

function trimAcceptedCommands(snapshot: MatchSnapshot) {
  const commandIds = Object.keys(snapshot.acceptedCommands);
  const excess = commandIds.length - ACCEPTED_COMMAND_HISTORY_LIMIT;
  for (let index = 0; index < excess; index += 1) {
    delete snapshot.acceptedCommands[commandIds[index]!];
  }
}

export function createRng(seed: number): Rng {
  let value = seed >>> 0;
  return { next() {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }};
}

/**
 * 将 0.x、仅含 snapshotVersion 的 1.0 快照和当前快照规范化为可演算结构。
 * 该函数会原地补齐可安全推导的兼容字段并返回同一个对象。
 */
export function normalizeMatchSnapshot(snapshot: MatchSnapshotInput): MatchSnapshot {
  const incoming = snapshot as unknown as {
    version?: unknown; snapshotVersion?: unknown; rulesetVersion?: unknown; rulesConfigSchemaVersion?: unknown;
  };
  for (const candidate of [incoming.version, incoming.snapshotVersion]) {
    if (candidate !== undefined && candidate !== MATCH_SNAPSHOT_VERSION) {
      throw new RangeError(`不支持的快照版本：${String(candidate)}`);
    }
  }
  if (incoming.version !== undefined && incoming.snapshotVersion !== undefined
    && incoming.version !== incoming.snapshotVersion) {
    throw new RangeError(`快照版本字段冲突：version=${String(incoming.version)}，snapshotVersion=${String(incoming.snapshotVersion)}`);
  }
  if (incoming.rulesConfigSchemaVersion !== undefined
    && incoming.rulesConfigSchemaVersion !== RULES_CONFIG_SCHEMA_VERSION
    && incoming.rulesConfigSchemaVersion !== "1.5.0"
    && incoming.rulesConfigSchemaVersion !== "1.4.0") {
    throw new RangeError(`不支持的规则配置版本：${String(incoming.rulesConfigSchemaVersion)}`);
  }
  const normalized = snapshot as MatchSnapshot;
  normalized.version ??= MATCH_SNAPSHOT_VERSION;
  normalized.snapshotVersion ??= MATCH_SNAPSHOT_VERSION;
  normalized.rulesetVersion ??= RULESET_VERSION;
  // 1.5/1.6 只增加可缺省的技能、场地效果和补给状态；旧对局可原地、安全升级。
  normalized.rulesConfigSchemaVersion = RULES_CONFIG_SCHEMA_VERSION;
  normalized.events ??= [];
  normalized.eventSequence ??= 0;
  normalized.combatEvents ??= [];
  normalized.acceptedCommands ??= {};
  trimAcceptedCommands(normalized);
  normalized.lastClientSeq ??= [0, 0];
  normalized.simulationTimeMs ??= Number.isFinite(normalized.serverTime) ? normalized.serverTime : 0;
  normalized.serverTime = normalized.simulationTimeMs;
  for (const player of normalized.players) {
    player.introRound ??= 10;
    player.pendingArrowImpacts ??= [];
    player.pendingGeneralImpacts ??= [];
    player.zhaoPhantoms ??= [];
    player.rainBossIds ??= [];
    player.visionDarkMs ??= 0;
    player.battleBuffs ??= [];
    player.battleFieldEffects ??= [];
    ensureProps(player);
    for (const unit of player.units) if (GENERALS[unit.kind]) {
      const floor = generalExperienceFloor(unit.kind, unit.level);
      if (floor > 0) unit.experience ??= floor;
    }
    for (const item of player.reserve) if (GENERALS[item.kind]) {
      const floor = generalExperienceFloor(item.kind, item.level);
      if (floor > 0) item.experience ??= floor;
    }
    for (const enemy of player.enemies) ensureEnemyMovement(normalized.mapIndex, enemy);
  }
  if (incoming.rulesetVersion !== undefined && incoming.rulesetVersion !== RULESET_VERSION) {
    throw new RangeError(`不支持的规则版本：${String(incoming.rulesetVersion)}`);
  }
  return normalized;
}

function beginTransition(snapshot: MatchSnapshot) {
  snapshot.events = [];
  snapshot.combatEvents = [];
}

function emitBattleEvent<const Payload extends BattleEventPayload>(snapshot: MatchSnapshot, payload: Payload) {
  snapshot.eventSequence += 1;
  const event = {
    ...payload,
    id: `event-${snapshot.eventSequence}`,
    tick: snapshot.tick,
    stateVersion: snapshot.stateVersion + 1,
  } as BattleEvent & Payload;
  snapshot.events.push(event);
  if (event.type === "attack") snapshot.combatEvents.push(event);
  return event;
}

function unitCells(unit: UnitState) {
  return unit.secondaryCell === undefined ? [unit.cell] : [unit.cell, unit.secondaryCell];
}

function reserveSlots(item: ReserveItem) {
  return item.secondarySlot === undefined ? [item.slot] : [item.slot, item.secondarySlot];
}

function weightedIndex(rng: Rng, weights: readonly number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng.next() * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index] ?? 0;
    if (roll < 0) return index;
  }
  return weights.length - 1;
}

const ORIGINAL_CELL_PX = 80;
const ENEMY_CELL_HALF = 0.5;

/** 安装包 d.Si：攻击圆半径先减 1px，再与敌军完整一格碰撞盒判交；擦边即命中。 */
export function attackRangeIntersectsCell(
  center: { x: number; y: number }, enemyCenter: { x: number; y: number }, rangeCells: number,
) {
  const radius = Math.max(0, rangeCells - 1 / ORIGINAL_CELL_PX);
  const closestX = Math.max(enemyCenter.x - ENEMY_CELL_HALF, Math.min(center.x, enemyCenter.x + ENEMY_CELL_HALF));
  const closestY = Math.max(enemyCenter.y - ENEMY_CELL_HALF, Math.min(center.y, enemyCenter.y + ENEMY_CELL_HALF));
  const dx = center.x - closestX;
  const dy = center.y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

/** 原包枪兵刺击碰撞：15px 宽的 71px 枪尖判定沿出枪方向移动，敌军碰撞盒为完整一格。 */
function pikeThrustIntersectsCell(
  source: { x: number; y: number }, target: { x: number; y: number }, enemy: { x: number; y: number },
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0.0001) return true;
  const extension = 71 / ORIGINAL_CELL_PX;
  const end = { x: target.x + dx / length * extension, y: target.y + dy / length * extension };
  const ex = end.x - source.x;
  const ey = end.y - source.y;
  const projection = Math.max(0, Math.min(1, ((enemy.x - source.x) * ex + (enemy.y - source.y) * ey) / (ex * ex + ey * ey)));
  const closest = { x: source.x + ex * projection, y: source.y + ey * projection };
  const collisionRadius = ENEMY_CELL_HALF + 15 / ORIGINAL_CELL_PX / 2;
  return Math.hypot(enemy.x - closest.x, enemy.y - closest.y) <= collisionRadius;
}

function emptyPropState(): PlayerPropState {
  return {
    configured: false, loadout: { active: [], passive: [] }, cooldowns: {}, charges: {}, placed: [],
    farmerSpawnMs: 30_000, superShovelMs: 60_000, meteorMs: 300_000,
  };
}

function ensureProps(player: PlayerBattleState) {
  player.props ??= emptyPropState();
  player.props.cooldowns ??= {};
  player.props.charges ??= {};
  player.props.placed ??= [];
  player.props.shovelSupplyClaimed ??= false;
  player.props.bulldozerSupplyClaimed ??= false;
  return player.props;
}

function clearUpgradeDispellable(player: PlayerBattleState, unit: UnitState) {
  delete unit.bossKnockedDown;
  delete unit.bossLockedMs;
  if ((player.rainBossIds ?? []).length) unit.rainDispelledBossIds = [...player.rainBossIds!];
}

function passiveLevel(player: PlayerBattleState | undefined, id: PassivePropId) {
  if (!player) return 0;
  return ensureProps(player).loadout.passive.find((entry) => entry.id === id)?.level ?? 0;
}

function hasPassive(player: PlayerBattleState | undefined, id: PassivePropId) {
  return passiveLevel(player, id) > 0;
}

function createPlayer(slot: PlayerSlot, mapIndex: number, introRound = 10): PlayerBattleState {
  const firstWave = WAVES[0];
  return {
    slot, hp: GAME_CONFIG.baseHp, maxHp: GAME_CONFIG.baseHp,
    buns: GAME_CONFIG.startBuns, recruitCost: GAME_CONFIG.recruitBase, recruitCount: 0,
    wave: 1, phase: "preparing", prepareMs: GAME_CONFIG.prepareMs,
    interwaveMs: 0, spawnMs: GAME_CONFIG.spawnMs, remainingToSpawn: firstWave[0],
    introRound: Math.max(0, Math.floor(introRound)),
    units: [], reserve: [], unlockedCells: initialOpenCells(mapIndex), enemies: [], battleBuffs: [], battleFieldEffects: [], props: emptyPropState(), lastEvent: "等待双方布阵",
  };
}

export function createMatch(
  roomId: string, seed: number, mapIndex = 0, introRounds: readonly [number, number] = [10, 10],
): MatchSnapshot {
  const normalizedSeed = Number.isFinite(seed) ? seed >>> 0 : 0;
  const normalizedMap = Number.isFinite(mapIndex) ? Math.max(0, Math.min(MAP_LAYOUTS.length - 1, Math.floor(mapIndex))) : 0;
  const planningRng = createRng(normalizedSeed);
  const difficultyCurve = weightedIndex(planningRng, DIFFICULTY_WEIGHTS);
  const bossWaves = BOSS_MILESTONES.filter((_, index) => planningRng.next() < (BOSS_CHANCES[index] ?? 0));
  return {
    version: MATCH_SNAPSHOT_VERSION, snapshotVersion: MATCH_SNAPSHOT_VERSION,
    rulesetVersion: RULESET_VERSION, rulesConfigSchemaVersion: RULES_CONFIG_SCHEMA_VERSION,
    roomId, tick: 0, stateVersion: 0, simulationTimeMs: 0,
    seed: normalizedSeed, mapIndex: normalizedMap, phase: "preparing", difficultyCurve, bossWaves,
    players: [createPlayer(0, normalizedMap, introRounds[0]), createPlayer(1, normalizedMap, introRounds[1])],
    events: [], eventSequence: 0, combatEvents: [], acceptedCommands: {}, lastClientSeq: [0, 0],
    winner: null, serverTime: 0,
  };
}

function unitStats(unit: UnitState, player?: PlayerBattleState, opponent?: PlayerBattleState) {
  const hero = GENERALS[unit.kind];
  const soldier = SOLDIERS[unit.kind as keyof typeof SOLDIERS];
  const base = hero ?? soldier;
  if (!base) return null;
  const levelIndex = Math.min(unit.level, base.maxLevel) - 1;
  const attackCurve = hero ? GENERAL_LEVEL_ATTACK : SOLDIER_LEVEL_ATTACK;
  const speedCurve = hero ? GENERAL_LEVEL_SPEED : SOLDIER_LEVEL_SPEED;
  const universalSpeed = (hasPassive(player, 14) ? 0.1 : 0)
    + (opponent && hasPassive(opponent, 14) ? 0.1 : 0);
  const togetherSpeed = (hasPassive(player, 15) ? 0.5 : 0) + (hasPassive(opponent, 15) ? 0.3 : 0);
  const rainPenalty = (player?.rainBossIds ?? [])
    .filter((id) => !(unit.rainDispelledBossIds ?? []).includes(id)).length * -0.2;
  const speedMultiplier = Math.max(0.05,
    1 + universalSpeed + togetherSpeed + ((unit.attackSpeedMultiplier ?? 1) - 1)
      + ((unit.temporaryAttackSpeedMultiplier ?? 1) - 1) + rainPenalty);
  return {
    attack: base.attack * (attackCurve[levelIndex] ?? 1),
    intervalMs: base.intervalMs / (speedCurve[levelIndex] ?? 1) / speedMultiplier,
    range: base.range * (unit.rangeMultiplier ?? 1),
    maxLevel: base.maxLevel,
  };
}

function recycleValue(items: readonly ReserveItem[]) {
  return items.reduce((sum, item) => sum + (item.kind === "铲子" ? 1 : 2 ** Math.max(0, item.level - 1)), 0);
}

const REUSABLE_RECRUIT_KINDS = new Set(["刀", "弓", "枪", "骑", "铲子", "农"]);

/** 原包 on.startGame/UO/TE：整局牌库只建一次；招贤榜逐份姓名字独立判定是否复制。 */
function ensureRecruitPool(player: PlayerBattleState, rng: Rng) {
  if (player.recruitPool?.length) return player.recruitPool;
  const pool = TOKEN_POOL.flatMap(([kind, weight]) => Array.from({ length: weight }, () => kind as string));
  if (ensureProps(player).earlyAccountShovelBonus) {
    for (let index = 0; index < EARLY_ACCOUNT_SHOVEL_BONUS; index += 1) pool.push("铲子");
  }
  if (hasPassive(player, 13)) {
    const initialLength = pool.length;
    for (let index = 0; index < initialLength; index += 1) {
      const kind = pool[index]!;
      if (!REUSABLE_RECRUIT_KINDS.has(kind) && rng.next() < 0.5) pool.push(kind);
    }
    player.recruitNameBonusApplied = true;
  }
  player.recruitPool = pool;
  return pool;
}

/** 原包 on.FO：基础兵/铲子可重复；姓名字抽中后从本局牌库移除。 */
function drawRecruitKind(player: PlayerBattleState, rng: Rng) {
  const pool = ensureRecruitPool(player, rng);
  const index = Math.min(pool.length - 1, Math.floor(rng.next() * pool.length));
  const kind = pool[index] ?? "刀";
  if (!REUSABLE_RECRUIT_KINDS.has(kind)) {
    pool.splice(index, 1);
    if (player.recruitNameBonusApplied) {
      const additional = pool.indexOf(kind);
      if (additional >= 0) pool.splice(additional, 1);
    }
  }
  return kind;
}

function recruit(snapshot: MatchSnapshot, player: PlayerBattleState, rng: Rng): string | null {
  const recycled = recycleValue(player.reserve);
  const spent = player.recruitCost;
  if (player.buns + recycled < spent) return "馒头不足";
  player.buns += recycled - spent;
  player.recruitCount += 1;
  player.recruitCost = GAME_CONFIG.recruitBase + player.recruitCount * GAME_CONFIG.recruitStep;
  const promotionChance = [0.05, 0.1, 0.15][Math.max(0, Math.min(2, passiveLevel(player, 22) - 1))] ?? 0;
  player.reserve = Array.from({ length: GAME_CONFIG.reserveSize }, (_, slot) => {
    const kind = drawRecruitKind(player, rng);
    const level = kind in SOLDIERS && promotionChance > 0 && rng.next() < promotionChance ? 2 : 1;
    return { id: `r-${player.slot}-${player.recruitCount}-${slot}-${Math.floor(rng.next() * 1e7)}`, kind, level, slot };
  });
  player.lastEvent = recycled > 0
    ? `回收${recycled}馒头，征得五枚棋子`
    : `征兵五枚：${player.reserve.map((item) => item.kind).join("、")}`;
  emitBattleEvent(snapshot, {
    type: "recruited", slot: player.slot, reserveIds: player.reserve.map((item) => item.id),
    spentBuns: spent, recycledBuns: recycled,
  });
  return null;
}

function isAdjacentToUnlocked(player: PlayerBattleState, targetCell: number) {
  const target = cellCoords(targetCell);
  return player.unlockedCells.some((cell) => {
    const open = cellCoords(cell);
    return Math.abs(open.x - target.x) + Math.abs(open.y - target.y) === 1;
  });
}

function canBuild(player: PlayerBattleState, targetCell: number) {
  return targetCell >= 0
    && targetCell < GAME_CONFIG.rows * GAME_CONFIG.columns
    && player.unlockedCells.includes(targetCell);
}

function occupiesCell(unit: UnitState, cell: number) {
  return unit.cell === cell || unit.secondaryCell === cell;
}

function unitAtCell(player: PlayerBattleState, cell: number) {
  return player.units.find((unit) => occupiesCell(unit, cell));
}

function reserveOccupiesSlot(item: ReserveItem, slot: number) {
  return item.slot === slot || item.secondarySlot === slot;
}

function reserveAtSlot(player: PlayerBattleState, slot: number, exceptId?: string) {
  return player.reserve.find((item) => item.id !== exceptId && reserveOccupiesSlot(item, slot));
}

function validReserveSlot(slot: number) {
  return Number.isInteger(slot) && slot >= 0 && slot < GAME_CONFIG.reserveSize;
}

function adjacentReserveSlot(player: PlayerBattleState, targetSlot: number, source?: ReserveItem) {
  const preferred = source && Math.abs(source.slot - targetSlot) === 1 ? source.slot : null;
  if (preferred !== null && !reserveAtSlot(player, preferred, source?.id)) return preferred;
  for (const slot of [targetSlot - 1, targetSlot + 1]) {
    if (validReserveSlot(slot) && !reserveAtSlot(player, slot, source?.id)) return slot;
  }
  return null;
}

function maxLevelForKind(kind: string) {
  if (kind === "农") return 5;
  return GENERALS[kind]?.maxLevel ?? SOLDIERS[kind as keyof typeof SOLDIERS]?.maxLevel ?? null;
}

function generalExperienceThresholds(kind: string) {
  const general = GENERALS[kind];
  return general ? GENERAL_EXPERIENCE.thresholds[general.rarity] : null;
}

function generalExperienceFloor(kind: string, level: number) {
  const thresholds = generalExperienceThresholds(kind);
  return thresholds?.[Math.max(0, Math.min(thresholds.length - 1, level - 1))] ?? 0;
}

function grantGeneralKillExperience(
  snapshot: MatchSnapshot,
  player: PlayerBattleState,
  unit: UnitState,
  defeatedCount: number,
) {
  const general = GENERALS[unit.kind];
  if (!general || defeatedCount <= 0 || unit.level >= general.maxLevel) return;
  const thresholds = GENERAL_EXPERIENCE.thresholds[general.rarity];
  unit.experience = Math.max(unit.experience ?? 0, generalExperienceFloor(unit.kind, unit.level))
    + defeatedCount * GENERAL_EXPERIENCE.directKill;
  const fromLevel = unit.level;
  while (unit.level < general.maxLevel && unit.experience >= (thresholds[unit.level] ?? Number.POSITIVE_INFINITY)) {
    unit.level += 1;
  }
  if (unit.level === fromLevel) return;
  unit.cooldownMs = 0;
  unit.attackCount = 0;
  clearUpgradeDispellable(player, unit);
  player.lastEvent = `${unit.kind}击杀成长，升至 Lv.${unit.level}`;
  emitBattleEvent(snapshot, {
    type: "unit-upgraded", slot: player.slot, unitId: unit.id, unitKind: unit.kind,
    fromLevel, toLevel: unit.level, experience: unit.experience, source: "combat-experience",
  });
}

function grantGeneralExperienceForNewDefeats(
  snapshot: MatchSnapshot,
  player: PlayerBattleState,
  unit: UnitState,
  aliveBefore: ReadonlySet<string>,
) {
  const defeatedCount = player.enemies.filter((enemy) => aliveBefore.has(enemy.id) && enemy.hp <= 0).length;
  grantGeneralKillExperience(snapshot, player, unit, defeatedCount);
}

function isMergeAttempt(source: { kind: string; level: number }, target: { kind: string; level: number }) {
  return Boolean(HERO_PAIRS[`${source.kind}+${target.kind}`])
    || (source.kind === target.kind && source.level === target.level && maxLevelForKind(target.kind) !== null);
}

function adjacentReserveSlotExcluding(player: PlayerBattleState, targetSlot: number, excludedIds: ReadonlySet<string>) {
  for (const slot of [targetSlot - 1, targetSlot + 1]) {
    if (!validReserveSlot(slot)) continue;
    const occupied = player.reserve.some((item) => !excludedIds.has(item.id) && reserveOccupiesSlot(item, slot));
    if (!occupied) return slot;
  }
  return null;
}

function adjacentCellExcluding(player: PlayerBattleState, targetCell: number, excludedIds: ReadonlySet<string>) {
  const target = cellCoords(targetCell);
  for (const [x, y] of [
    [target.x - 1, target.y], [target.x + 1, target.y],
  ]) {
    if (x === undefined || y === undefined || x < 0 || x >= GAME_CONFIG.columns || y < 0 || y >= GAME_CONFIG.rows) continue;
    const cell = y * GAME_CONFIG.columns + x;
    if (!canBuild(player, cell)) continue;
    const occupied = player.units.some((unit) => !excludedIds.has(unit.id) && occupiesCell(unit, cell));
    if (!occupied) return cell;
  }
  return null;
}

function reserveToUnit(item: ReserveItem, cell: number, secondaryCell?: number): UnitState {
  return {
    id: item.id.replace(/^r-/, "u-"), kind: item.kind, level: item.level, cell,
    ...(item.experience === undefined ? {} : { experience: item.experience }),
    ...(item.incomeMs === undefined ? {} : { incomeMs: item.incomeMs }),
    ...(secondaryCell === undefined ? {} : {
      secondaryCell,
      parts: item.parts ?? [item.kind[0] ?? "", item.kind[1] ?? ""] as [string, string],
    }),
    cooldownMs: 0, attackCount: 0,
  };
}

function unitToReserve(unit: UnitState, slot: number, secondarySlot?: number): ReserveItem {
  return {
    id: unit.id.replace(/^u-/, "r-"), kind: unit.kind, level: unit.level, slot,
    ...(unit.experience === undefined ? {} : { experience: unit.experience }),
    ...(unit.incomeMs === undefined ? {} : { incomeMs: unit.incomeMs }),
    ...(secondarySlot === undefined ? {} : {
      secondarySlot,
      parts: unit.parts ?? [unit.kind[0] ?? "", unit.kind[1] ?? ""] as [string, string],
    }),
  };
}

/** 战场姓名字横向相邻即合将；返回生成武将的单位 ID。 */
function autoCombineHorizontalGeneral(
  snapshot: MatchSnapshot,
  player: PlayerBattleState,
  unitId: string,
  ignoredNeighborIds: ReadonlySet<string> = new Set(),
) {
  const source = player.units.find((unit) => unit.id === unitId);
  if (!source || source.secondaryCell !== undefined) return null;
  const sourcePoint = cellCoords(source.cell);
  const neighborCells = [sourcePoint.x - 1, sourcePoint.x + 1]
    .filter((x) => x >= 0 && x < GAME_CONFIG.columns)
    .map((x) => sourcePoint.y * GAME_CONFIG.columns + x)
    .sort((a, b) => a - b);

  for (const neighborCell of neighborCells) {
    const neighbor = unitAtCell(player, neighborCell);
    if (!neighbor || neighbor.id === source.id || ignoredNeighborIds.has(neighbor.id) || neighbor.secondaryCell !== undefined) continue;
    const hero = HERO_PAIRS[`${source.kind}+${neighbor.kind}`];
    if (!hero) continue;

    const [survivor, consumed] = source.cell < neighbor.cell ? [source, neighbor] : [neighbor, source];
    survivor.kind = hero;
    survivor.level = Math.max(source.level, neighbor.level);
    const experience = Math.max(source.experience ?? 0, neighbor.experience ?? 0, generalExperienceFloor(hero, survivor.level));
    if (experience > 0) survivor.experience = experience;
    else delete survivor.experience;
    survivor.cell = Math.min(source.cell, neighbor.cell);
    survivor.secondaryCell = Math.max(source.cell, neighbor.cell);
    survivor.parts = [hero[0] ?? source.kind, hero[1] ?? neighbor.kind];
    survivor.cooldownMs = 0;
    survivor.attackCount = 0;
    clearUpgradeDispellable(player, survivor);
    player.units = player.units.filter((unit) => unit.id !== consumed.id);
    player.lastEvent = `横向相邻合成「${hero}」Lv.${survivor.level}`;
    emitBattleEvent(snapshot, {
      type: "units-merged", slot: player.slot, sourceId: consumed.id, targetId: survivor.id,
      resultKind: survivor.kind, resultLevel: survivor.level, location: "board", cells: unitCells(survivor),
    });
    return survivor.id;
  }
  return null;
}

function adjacentCellForGeneral(player: PlayerBattleState, target: UnitState, source?: UnitState) {
  const targetPoint = cellCoords(target.cell);
  if (source) {
    const sourcePoint = cellCoords(source.cell);
    if (sourcePoint.y === targetPoint.y && Math.abs(sourcePoint.x - targetPoint.x) === 1) return source.cell;
  }
  const candidates = [
    [targetPoint.x - 1, targetPoint.y], [targetPoint.x + 1, targetPoint.y],
  ];
  for (const [x, y] of candidates) {
    if (x === undefined || y === undefined || x < 0 || x >= GAME_CONFIG.columns || y < 0 || y >= GAME_CONFIG.rows) continue;
    const cell = y * GAME_CONFIG.columns + x;
    if (!canBuild(player, cell)) continue;
    const occupant = unitAtCell(player, cell);
    if (!occupant || occupant.id === source?.id) return cell;
  }
  return null;
}

function emptyAdjacentBuildCell(player: PlayerBattleState, targetCell: number) {
  const target = cellCoords(targetCell);
  for (const [x, y] of [
    [target.x - 1, target.y], [target.x + 1, target.y],
  ]) {
    if (x === undefined || y === undefined || x < 0 || x >= GAME_CONFIG.columns || y < 0 || y >= GAME_CONFIG.rows) continue;
    const cell = y * GAME_CONFIG.columns + x;
    if (canBuild(player, cell) && !unitAtCell(player, cell)) return cell;
  }
  return null;
}

function combine(player: PlayerBattleState, source: { kind: string; level: number; experience?: number }, target: UnitState, sourceUnit?: UnitState): string | null {
  const hero = HERO_PAIRS[`${source.kind}+${target.kind}`];
  if (hero) {
    const companionCell = adjacentCellForGeneral(player, target, sourceUnit);
    if (companionCell === null) return "武将需要占用横向相邻两格，请先腾出空位";
    const cells = [target.cell, companionCell].sort((a, b) => a - b);
    const parts = [...hero];
    target.kind = hero;
    target.level = Math.max(source.level, target.level);
    const experience = Math.max(source.experience ?? 0, target.experience ?? 0, generalExperienceFloor(hero, target.level));
    if (experience > 0) target.experience = experience;
    else delete target.experience;
    target.cell = cells[0]!;
    target.secondaryCell = cells[1]!;
    target.parts = [parts[0] ?? source.kind, parts[1] ?? target.kind];
    target.cooldownMs = 0; target.attackCount = 0;
    clearUpgradeDispellable(player, target);
    return null;
  }
  if (source.kind !== target.kind || source.level !== target.level) return "文字或等级不符合合成关系";
  const maxLevel = unitStats(target)?.maxLevel;
  if (!maxLevel) return "文字单位不能同字升级";
  if (target.level >= maxLevel) return "单位已满级";
  target.level += 1; target.cooldownMs = 0; target.attackCount = 0;
  if (GENERALS[target.kind]) target.experience = generalExperienceFloor(target.kind, target.level);
  clearUpgradeDispellable(player, target);
  return null;
}

function combineReserve(player: PlayerBattleState, source: { kind: string; level: number; experience?: number }, target: ReserveItem, sourceItem?: ReserveItem): string | null {
  const hero = HERO_PAIRS[`${source.kind}+${target.kind}`];
  if (hero) {
    const companionSlot = adjacentReserveSlot(player, target.slot, sourceItem);
    if (companionSlot === null) return "两字武将需要占用营地相邻两格";
    const slots = [target.slot, companionSlot].sort((a, b) => a - b);
    target.kind = hero;
    target.level = Math.max(source.level, target.level);
    const experience = Math.max(source.experience ?? 0, target.experience ?? 0, generalExperienceFloor(hero, target.level));
    if (experience > 0) target.experience = experience;
    else delete target.experience;
    target.slot = slots[0]!;
    target.secondarySlot = slots[1]!;
    target.parts = [hero[0] ?? source.kind, hero[1] ?? target.kind];
    return null;
  }
  if (source.kind !== target.kind || source.level !== target.level) return "文字或等级不符合合成关系";
  const maxLevel = maxLevelForKind(target.kind);
  if (!maxLevel) return "文字单位不能同字升级";
  if (target.level >= maxLevel) return "单位已满级";
  target.level += 1;
  if (GENERALS[target.kind]) target.experience = generalExperienceFloor(target.kind, target.level);
  return null;
}

function dropReserve(snapshot: MatchSnapshot, player: PlayerBattleState, reserveId: string, targetCell: number): string | null {
  const item = player.reserve.find((candidate) => candidate.id === reserveId);
  if (!item) return "营地棋子不存在";
  if (item.kind === "铲子") {
    if (cellCode(snapshot.mapIndex, targetCell) !== "2_0") return "铲子只能开垦己方草格";
    if (player.unlockedCells.includes(targetCell)) return "该格已经开放";
    player.unlockedCells.push(targetCell);
    player.reserve = player.reserve.filter((candidate) => candidate.id !== reserveId);
    player.lastEvent = "铲子开垦一格";
    emitBattleEvent(snapshot, { type: "cell-unlocked", slot: player.slot, cell: targetCell, sourceReserveId: reserveId });
    if (hasPassive(player, 24)) {
      const rewardRng = createRng(snapshot.seed ^ ((snapshot.stateVersion + 1) * 0x85EBCA6B) ^ targetCell ^ reserveId.length);
      const rewardBuns = 1 + Math.floor(rewardRng.next() * 10);
      player.buns += rewardBuns;
      player.lastEvent = `金铲子挖出宝箱，+${rewardBuns}馒头`;
      emitBattleEvent(snapshot, { type: "prop-triggered", slot: player.slot, propId: 24, targetIds: [], rewardBuns });
    }
    return null;
  }
  if (!canBuild(player, targetCell)) return "只能放入己方已开放白格";
  const target = unitAtCell(player, targetCell);
  if (target) {
    if (item.secondarySlot === undefined) {
      const partUpgrade = upgradeGeneralWithMatchingPart(player, item, target, targetCell);
      if (partUpgrade.matched) {
        if (partUpgrade.error) return partUpgrade.error;
        player.reserve = player.reserve.filter((candidate) => candidate.id !== reserveId);
        player.lastEvent = `同字强化「${target.kind}」Lv.${target.level}`;
        emitBattleEvent(snapshot, {
          type: "units-merged", slot: player.slot, sourceId: reserveId, targetId: target.id,
          resultKind: target.kind, resultLevel: target.level, location: "board", cells: unitCells(target),
        });
        return null;
      }
      const replacement = replaceGeneralPart(item, target, targetCell);
      if (replacement.matched) {
        target.kind = replacement.hero; target.parts = replacement.parts;
        target.level = Math.max(target.level, item.level); target.cooldownMs = 0; target.attackCount = 0;
        item.kind = replacement.displacedKind;
        item.level = replacement.displacedLevel;
        item.secondarySlot = undefined; item.parts = undefined;
        player.lastEvent = `换字成将「${replacement.hero}」Lv.${target.level}`;
        emitBattleEvent(snapshot, {
          type: "units-swapped", slot: player.slot,
          placements: [{ id: target.id, cells: unitCells(target) }, { id: item.id, slots: reserveSlots(item) }],
        });
        return null;
      }
    }
    if (isMergeAttempt(item, target)) {
      const error = combine(player, item, target);
      if (error) return error;
      player.reserve = player.reserve.filter((candidate) => candidate.id !== reserveId);
      player.lastEvent = `合成「${target.kind}」Lv.${target.level}`;
      emitBattleEvent(snapshot, {
        type: "units-merged", slot: player.slot, sourceId: reserveId, targetId: target.id,
        resultKind: target.kind, resultLevel: target.level, location: "board", cells: unitCells(target),
      });
      return null;
    }
    const excluded = new Set([item.id, target.id]);
    const sourceCompanion = item.secondarySlot === undefined
      ? undefined
      : target.secondaryCell === undefined
        ? adjacentCellExcluding(player, targetCell, excluded) ?? undefined
        : target.cell === targetCell ? target.secondaryCell : target.cell;
    if (item.secondarySlot !== undefined && sourceCompanion === undefined) return "替换两格武将需要棋盘横向相邻空格";
    const targetCompanion = target.secondaryCell === undefined
      ? undefined
      : adjacentReserveSlotExcluding(player, item.slot, excluded) ?? undefined;
    if (target.secondaryCell !== undefined && targetCompanion === undefined) return "替换两格武将需要营地相邻空格";
    const sourceCells = sourceCompanion === undefined ? [targetCell] : [targetCell, sourceCompanion].sort((a, b) => a - b);
    const targetSlots = targetCompanion === undefined ? [item.slot] : [item.slot, targetCompanion].sort((a, b) => a - b);
    const deployed = reserveToUnit(item, sourceCells[0]!, sourceCells[1]);
    const returned = unitToReserve(target, targetSlots[0]!, targetSlots[1]);
    player.reserve = player.reserve.filter((candidate) => candidate.id !== item.id);
    player.units = player.units.filter((candidate) => candidate.id !== target.id);
    player.units.push(deployed);
    player.reserve.push(returned);
    player.lastEvent = `上阵「${item.kind}」，替换「${target.kind}」`;
    emitBattleEvent(snapshot, {
      type: "units-swapped", slot: player.slot,
      placements: [{ id: deployed.id, cells: unitCells(deployed) }, { id: returned.id, slots: reserveSlots(returned) }],
    });
    autoCombineHorizontalGeneral(snapshot, player, deployed.id);
    return null;
  }
  if (item.secondarySlot !== undefined && GENERALS[item.kind]) {
    const companionCell = emptyAdjacentBuildCell(player, targetCell);
    if (companionCell === null) return "两字武将需要占用棋盘横向相邻两格";
    const cells = [targetCell, companionCell].sort((a, b) => a - b);
    const unit: UnitState = {
      id: item.id.replace(/^r-/, "u-"), kind: item.kind, level: item.level,
      cell: cells[0]!, secondaryCell: cells[1]!, parts: item.parts ?? [item.kind[0] ?? "", item.kind[1] ?? ""],
      cooldownMs: 0, attackCount: 0,
    };
    player.units.push(unit);
    player.reserve = player.reserve.filter((candidate) => candidate.id !== reserveId);
    player.lastEvent = `上阵武将「${item.kind}」`;
    emitBattleEvent(snapshot, { type: "unit-deployed", slot: player.slot, unitId: unit.id, unitKind: unit.kind, cells: unitCells(unit) });
    return null;
  }
  const deployed: UnitState = {
    id: item.id.replace(/^r-/, "u-"), kind: item.kind, level: item.level, cell: targetCell,
    cooldownMs: 0, attackCount: 0,
  };
  player.units.push(deployed);
  player.reserve = player.reserve.filter((candidate) => candidate.id !== reserveId);
  player.lastEvent = `上阵「${item.kind}」`;
  emitBattleEvent(snapshot, {
    type: "unit-deployed", slot: player.slot, unitId: deployed.id, unitKind: deployed.kind, cells: unitCells(deployed),
  });
  autoCombineHorizontalGeneral(snapshot, player, deployed.id);
  return null;
}

function dropReserveToSlot(snapshot: MatchSnapshot, player: PlayerBattleState, reserveId: string, targetSlot: number): string | null {
  if (!validReserveSlot(targetSlot)) return "营地目标格不存在";
  const source = player.reserve.find((item) => item.id === reserveId);
  if (!source) return "营地棋子不存在";
  if (reserveOccupiesSlot(source, targetSlot)) return null;
  const target = reserveAtSlot(player, targetSlot, source.id);
  if (target) {
    if (source.secondarySlot === undefined) {
      const partUpgrade = upgradeReserveGeneralWithMatchingPart(source, target, targetSlot);
      if (partUpgrade.matched) {
        if (partUpgrade.error) return partUpgrade.error;
        player.reserve = player.reserve.filter((item) => item.id !== source.id);
        player.lastEvent = `营地同字强化「${target.kind}」Lv.${target.level}`;
        emitBattleEvent(snapshot, {
          type: "units-merged", slot: player.slot, sourceId: source.id, targetId: target.id,
          resultKind: target.kind, resultLevel: target.level, location: "reserve", slots: reserveSlots(target),
        });
        return null;
      }
      const replacement = replaceReserveGeneralPart(source, target, targetSlot);
      if (replacement.matched) {
        target.kind = replacement.hero; target.parts = replacement.parts;
        target.level = Math.max(target.level, source.level);
        source.kind = replacement.displacedKind;
        source.level = replacement.displacedLevel;
        source.secondarySlot = undefined; source.parts = undefined;
        player.lastEvent = `营地换字成将「${replacement.hero}」Lv.${target.level}`;
        emitBattleEvent(snapshot, {
          type: "units-swapped", slot: player.slot,
          placements: [{ id: target.id, slots: reserveSlots(target) }, { id: source.id, slots: reserveSlots(source) }],
        });
        return null;
      }
    }
    if (isMergeAttempt(source, target)) {
      const error = combineReserve(player, source, target, source);
      if (error) return error;
      player.reserve = player.reserve.filter((item) => item.id !== source.id);
      player.lastEvent = `营地合成「${target.kind}」Lv.${target.level}`;
      emitBattleEvent(snapshot, {
        type: "units-merged", slot: player.slot, sourceId: source.id, targetId: target.id,
        resultKind: target.kind, resultLevel: target.level, location: "reserve", slots: reserveSlots(target),
      });
      return null;
    }
    const excluded = new Set([source.id, target.id]);
    const sourceCompanion = source.secondarySlot === undefined
      ? undefined
      : target.secondarySlot === undefined
        ? adjacentReserveSlotExcluding(player, targetSlot, excluded) ?? undefined
        : target.slot === targetSlot ? target.secondarySlot : target.slot;
    if (source.secondarySlot !== undefined && sourceCompanion === undefined) return "交换两格武将需要目标旁有连续空位";
    const targetCompanion = target.secondarySlot === undefined
      ? undefined
      : adjacentReserveSlotExcluding(player, source.slot, excluded) ?? undefined;
    if (target.secondarySlot !== undefined && targetCompanion === undefined) return "交换两格武将需要原位旁有连续空位";
    const sourceSlots = sourceCompanion === undefined ? [targetSlot] : [targetSlot, sourceCompanion].sort((a, b) => a - b);
    const targetSlots = targetCompanion === undefined ? [source.slot] : [source.slot, targetCompanion].sort((a, b) => a - b);
    source.slot = sourceSlots[0]!;
    source.secondarySlot = sourceSlots[1];
    target.slot = targetSlots[0]!;
    target.secondarySlot = targetSlots[1];
    player.lastEvent = `营地交换「${source.kind}」与「${target.kind}」`;
    emitBattleEvent(snapshot, {
      type: "units-swapped", slot: player.slot,
      placements: [{ id: source.id, slots: reserveSlots(source) }, { id: target.id, slots: reserveSlots(target) }],
    });
    return null;
  }
  if (source.secondarySlot !== undefined) {
    const companionSlot = adjacentReserveSlot(player, targetSlot, source);
    if (companionSlot === null) return "两字武将需要占用营地相邻两格";
    const slots = [targetSlot, companionSlot].sort((a, b) => a - b);
    source.slot = slots[0]!;
    source.secondarySlot = slots[1]!;
  } else {
    source.slot = targetSlot;
  }
  player.lastEvent = `移动营地棋子「${source.kind}」`;
  emitBattleEvent(snapshot, { type: "reserve-moved", slot: player.slot, reserveId: source.id, slots: reserveSlots(source) });
  return null;
}

function dropUnitToReserve(snapshot: MatchSnapshot, player: PlayerBattleState, unitId: string, targetSlot: number): string | null {
  if (!validReserveSlot(targetSlot)) return "营地目标格不存在";
  const source = player.units.find((unit) => unit.id === unitId);
  if (!source) return "单位不存在";
  if ((source.bossLockedMs ?? 0) !== 0 || (source.bossChaosMs ?? 0) > 0 || source.bossKnockedDown) return "单位正受 Boss 控制，暂时无法移动";
  if (source.secondaryCell !== undefined) return "两格武将请先拆字再放回营地";
  const target = reserveAtSlot(player, targetSlot);
  if (target) {
    const partUpgrade = upgradeReserveGeneralWithMatchingPart(source, target, targetSlot);
    if (partUpgrade.matched) {
      if (partUpgrade.error) return partUpgrade.error;
      player.units = player.units.filter((unit) => unit.id !== source.id);
      player.lastEvent = `营地同字强化「${target.kind}」Lv.${target.level}`;
      emitBattleEvent(snapshot, {
        type: "units-merged", slot: player.slot, sourceId: source.id, targetId: target.id,
        resultKind: target.kind, resultLevel: target.level, location: "reserve", slots: reserveSlots(target),
      });
      return null;
    }
    if (isMergeAttempt(source, target)) {
      const error = combineReserve(player, source, target);
      if (error) return error;
      player.units = player.units.filter((unit) => unit.id !== source.id);
      player.lastEvent = `营地合成「${target.kind}」Lv.${target.level}`;
      emitBattleEvent(snapshot, {
        type: "units-merged", slot: player.slot, sourceId: source.id, targetId: target.id,
        resultKind: target.kind, resultLevel: target.level, location: "reserve", slots: reserveSlots(target),
      });
      return null;
    }
    const excluded = new Set([source.id, target.id]);
    const targetCompanion = target.secondarySlot === undefined
      ? undefined
      : adjacentCellExcluding(player, source.cell, excluded) ?? undefined;
    if (target.secondarySlot !== undefined && targetCompanion === undefined) return "替换两格武将需要棋盘横向相邻空格";
    const targetCells = targetCompanion === undefined ? [source.cell] : [source.cell, targetCompanion].sort((a, b) => a - b);
    const returned = unitToReserve(source, targetSlot);
    const deployed = reserveToUnit(target, targetCells[0]!, targetCells[1]);
    player.units = player.units.filter((unit) => unit.id !== source.id);
    player.reserve = player.reserve.filter((item) => item.id !== target.id);
    player.reserve.push(returned);
    player.units.push(deployed);
    player.lastEvent = `「${source.kind}」回营，替换「${target.kind}」`;
    emitBattleEvent(snapshot, {
      type: "units-swapped", slot: player.slot,
      placements: [{ id: returned.id, slots: reserveSlots(returned) }, { id: deployed.id, cells: unitCells(deployed) }],
    });
    autoCombineHorizontalGeneral(snapshot, player, deployed.id);
    return null;
  }
  const returned = unitToReserve(source, targetSlot);
  player.units = player.units.filter((unit) => unit.id !== source.id);
  player.reserve.push(returned);
  player.lastEvent = `「${source.kind}」返回营地`;
  emitBattleEvent(snapshot, {
    type: "unit-returned", slot: player.slot, unitId: source.id, unitKind: source.kind, slots: reserveSlots(returned),
  });
  return null;
}

function dropUnit(snapshot: MatchSnapshot, player: PlayerBattleState, unitId: string, targetCell: number): string | null {
  if (!canBuild(player, targetCell)) return "只能放入己方已开放白格";
  const source = player.units.find((candidate) => candidate.id === unitId);
  if (!source) return "单位不存在";
  if ((source.bossLockedMs ?? 0) !== 0 || (source.bossChaosMs ?? 0) > 0 || source.bossKnockedDown) return "单位正受 Boss 控制，暂时无法移动";
  const target = unitAtCell(player, targetCell);
  if (!target) {
    if (source.secondaryCell !== undefined) return "两格武将需要先拆字再移动";
    const fromCells = unitCells(source);
    source.cell = targetCell;
    player.lastEvent = `移动「${source.kind}」`;
    emitBattleEvent(snapshot, { type: "unit-moved", slot: player.slot, unitId: source.id, fromCells, toCells: unitCells(source) });
    autoCombineHorizontalGeneral(snapshot, player, source.id);
    return null;
  }
  if (target.id === source.id) return null;
  if ((target.bossLockedMs ?? 0) !== 0 || (target.bossChaosMs ?? 0) > 0 || target.bossKnockedDown) return "目标单位正受 Boss 控制，暂时无法交互";
  if (source.secondaryCell === undefined) {
    const partUpgrade = upgradeGeneralWithMatchingPart(player, source, target, targetCell);
      if (partUpgrade.matched) {
        if (partUpgrade.error) return partUpgrade.error;
        player.units = player.units.filter((candidate) => candidate.id !== source.id);
      player.lastEvent = `同字强化「${target.kind}」Lv.${target.level}`;
      emitBattleEvent(snapshot, {
        type: "units-merged", slot: player.slot, sourceId: source.id, targetId: target.id,
        resultKind: target.kind, resultLevel: target.level, location: "board", cells: unitCells(target),
        });
        return null;
      }
      const replacement = replaceGeneralPart(source, target, targetCell);
      if (replacement.matched) {
        const freeSlot = firstEmptyReserveSlot(player);
        if (freeSlot === null) return "换下的姓名字需要一个空营地格";
        target.kind = replacement.hero; target.parts = replacement.parts;
        target.level = Math.max(target.level, source.level); target.cooldownMs = 0; target.attackCount = 0;
        player.units = player.units.filter((candidate) => candidate.id !== source.id);
        const returned: ReserveItem = {
          id: source.id.replace(/^u-/, "r-"), kind: replacement.displacedKind,
          level: replacement.displacedLevel, slot: freeSlot,
        };
        player.reserve.push(returned);
        player.lastEvent = `换字成将「${replacement.hero}」Lv.${target.level}`;
        emitBattleEvent(snapshot, {
          type: "units-swapped", slot: player.slot,
          placements: [{ id: target.id, cells: unitCells(target) }, { id: returned.id, slots: [returned.slot] }],
        });
        return null;
      }
    }
  if (isMergeAttempt(source, target)) {
    const error = combine(player, source, target, source);
    if (error) return error;
    player.units = player.units.filter((candidate) => candidate.id !== source.id);
    player.lastEvent = `合成「${target.kind}」Lv.${target.level}`;
    emitBattleEvent(snapshot, {
      type: "units-merged", slot: player.slot, sourceId: source.id, targetId: target.id,
      resultKind: target.kind, resultLevel: target.level, location: "board", cells: unitCells(target),
    });
    return null;
  }
  const sourceCell = source.cell;
  if (target.secondaryCell === undefined) {
    source.cell = targetCell;
    target.cell = sourceCell;
  } else {
    const companionCell = adjacentCellExcluding(player, sourceCell, new Set([source.id, target.id]));
    if (companionCell === null) return "交换两格武将需要原位旁有横向相邻空格";
    const targetCells = [sourceCell, companionCell].sort((a, b) => a - b);
    source.cell = targetCell;
    target.cell = targetCells[0]!;
    target.secondaryCell = targetCells[1]!;
  }
  player.lastEvent = `交换「${source.kind}」与「${target.kind}」`;
  emitBattleEvent(snapshot, {
    type: "units-swapped", slot: player.slot,
    placements: [{ id: source.id, cells: unitCells(source) }, { id: target.id, cells: unitCells(target) }],
  });
  autoCombineHorizontalGeneral(snapshot, player, source.id);
  autoCombineHorizontalGeneral(snapshot, player, target.id);
  return null;
}

function splitGeneral(snapshot: MatchSnapshot, player: PlayerBattleState, unitId: string, partIndex: 0 | 1, targetCell: number): string | null {
  if (!canBuild(player, targetCell)) return "只能拆到己方已开放白格";
  const general = player.units.find((unit) => unit.id === unitId);
  if (!general || general.secondaryCell === undefined || !GENERALS[general.kind]) return "该单位不是可拆分武将";
  const cells: [number, number] = [general.cell, general.secondaryCell];
  if (cells.includes(targetCell)) return null;
  const target = unitAtCell(player, targetCell);
  if (target && ((target.bossLockedMs ?? 0) !== 0 || (target.bossChaosMs ?? 0) > 0 || target.bossKnockedDown)) {
    return "目标单位正受 Boss 控制，暂时无法交互";
  }
  const parts = general.parts ?? [general.kind[0] ?? "", general.kind[1] ?? ""];

  if (target?.secondaryCell !== undefined && GENERALS[target.kind]) {
    if (target.level !== general.level) return "两名武将必须同级才能交换姓名字";
    const targetCells: [number, number] = [target.cell, target.secondaryCell];
    const targetPartIndex: 0 | 1 = targetCell === target.cell ? 0 : 1;
    const targetParts = [...(target.parts ?? [target.kind[0] ?? "", target.kind[1] ?? ""])] as [string, string];
    const sourceParts = [...parts] as [string, string];
    const sourceKind = sourceParts[partIndex];
    const targetKind = targetParts[targetPartIndex];
    sourceParts[partIndex] = targetKind;
    targetParts[targetPartIndex] = sourceKind;
    const idBase = `part-swap-${snapshot.stateVersion + 1}`;
    const sourcePieces = sourceParts.map((kind, index) => ({
      id: `${general.id}-${idBase}-${index}`, kind, level: general.level,
      ...(general.experience === undefined ? {} : { experience: general.experience }),
      cell: cells[index]!, cooldownMs: 0, attackCount: 0,
    })) as [UnitState, UnitState];
    const targetPieces = targetParts.map((kind, index) => ({
      id: `${target.id}-${idBase}-${index}`, kind, level: target.level,
      ...(target.experience === undefined ? {} : { experience: target.experience }),
      cell: targetCells[index]!, cooldownMs: 0, attackCount: 0,
    })) as [UnitState, UnitState];
    player.units = player.units.filter((unit) => unit.id !== general.id && unit.id !== target.id);
    player.units.push(...sourcePieces, ...targetPieces);
    player.lastEvent = `武将换字「${sourceKind}」↔「${targetKind}」`;
    emitBattleEvent(snapshot, {
      type: "general-split", slot: player.slot, generalId: general.id,
      parts: sourcePieces.map((part) => ({ id: part.id, kind: part.kind, cell: part.cell })),
    });
    emitBattleEvent(snapshot, {
      type: "general-split", slot: player.slot, generalId: target.id,
      parts: targetPieces.map((part) => ({ id: part.id, kind: part.kind, cell: part.cell })),
    });
    emitBattleEvent(snapshot, {
      type: "units-swapped", slot: player.slot,
      placements: [...sourcePieces, ...targetPieces].map((part) => ({ id: part.id, cells: [part.cell] })),
    });
    for (const piece of [...sourcePieces, ...targetPieces]) autoCombineHorizontalGeneral(snapshot, player, piece.id);
    return null;
  }
  const otherIndex: 0 | 1 = partIndex === 0 ? 1 : 0;
  const idBase = `${general.id}-split-${snapshot.stateVersion + 1}`;
  const makePart = (index: 0 | 1, cell: number): UnitState => ({
    id: `${idBase}-${index}`, kind: parts[index], level: general.level, cell,
    ...(general.experience === undefined ? {} : { experience: general.experience }),
    cooldownMs: 0, attackCount: 0,
  });
  const stationaryPart = makePart(otherIndex, cells[otherIndex]);
  const movedPart = makePart(partIndex, targetCell);
  player.units = player.units.filter((unit) => unit.id !== general.id);
  const partsAfterSplit = [stationaryPart, movedPart];
  if (target) target.cell = cells[partIndex];
  player.units.push(...partsAfterSplit);
  player.lastEvent = target
    ? `拆字「${parts[partIndex]}」与「${target.kind}」交换`
    : `拆分「${general.kind}」为「${parts[0]}」「${parts[1]}」`;
  emitBattleEvent(snapshot, {
    type: "general-split", slot: player.slot, generalId: general.id,
    parts: partsAfterSplit.map((part) => ({ id: part.id, kind: part.kind, cell: part.cell })),
  });
  if (target) {
    emitBattleEvent(snapshot, {
      type: "units-swapped", slot: player.slot,
      placements: [{ id: movedPart.id, cells: [movedPart.cell] }, { id: target.id, cells: [target.cell] }],
    });
  }
  // A direct part-to-unit drop is an explicit swap. An empty-cell split may
  // still combine either character with a pre-existing neighbour, but the two
  // siblings produced by this command must not immediately fuse back together.
  // Otherwise dragging a part by one cell appears to do nothing to the player.
  if (!target) {
    autoCombineHorizontalGeneral(snapshot, player, movedPart.id, new Set([stationaryPart.id]));
    autoCombineHorizontalGeneral(snapshot, player, stationaryPart.id, new Set([movedPart.id]));
  }
  return null;
}

function mergeById(snapshot: MatchSnapshot, player: PlayerBattleState, sourceId: string, targetId: string): string | null {
  if (sourceId === targetId) return "不能与自身合成";
  const source = player.units.find((item) => item.id === sourceId);
  const target = player.units.find((item) => item.id === targetId);
  if (!source || !target) return "单位不存在";
  return dropUnit(snapshot, player, sourceId, target.cell);
}

function normalizeLoadout(loadout: PropLoadout): PropLoadout | null {
  const active = [...new Set(loadout.active)];
  const passive = loadout.passive.filter((entry, index, entries) => entries.findIndex((other) => other.id === entry.id) === index)
    .map((entry) => ({ id: entry.id, level: entry.id === 22 ? Math.max(1, Math.min(3, Math.floor(entry.level))) : 1 }));
  if (active.length !== loadout.active.length || passive.length !== loadout.passive.length) return null;
  if (active.length > 2 || passive.length > 6) return null;
  if (active.some((id) => !ACTIVE_PROP_IDS.includes(id))) return null;
  if (passive.some((entry) => !PASSIVE_PROP_IDS.includes(entry.id))) return null;
  return { active, passive };
}

function setPropLoadout(snapshot: MatchSnapshot, player: PlayerBattleState, loadout: PropLoadout, earlyAccountShovelBonus = false): string | null {
  if (snapshot.phase !== "preparing") return "只能在准备阶段装配道具";
  const props = ensureProps(player);
  if (props.configured) return "本局道具已经装配";
  const normalized = normalizeLoadout(loadout);
  if (!normalized) return "主动道具最多2件、被动道具最多6件，且不可重复";
  props.configured = true;
  props.earlyAccountShovelBonus = earlyAccountShovelBonus;
  player.recruitPool = undefined;
  player.recruitNameBonusApplied = false;
  props.loadout = normalized;
  for (const id of normalized.active) {
    props.cooldowns[id] = 0;
    if (id === 5) props.charges![id] = 10;
  }
  if (hasPassive(player, 16)) {
    player.maxHp += 5; player.hp += 5;
    const opponent = snapshot.players[player.slot === 0 ? 1 : 0];
    opponent.maxHp += 3; opponent.hp += 3;
  }
  if (hasPassive(player, 17)) { player.maxHp += 3; player.hp += 3; }
  player.lastEvent = normalized.active.length || normalized.passive.length
    ? `装配道具：${[...normalized.active, ...normalized.passive.map((entry) => entry.id)].map((id) => PROPS[id]?.name).join("、")}`
    : "本局未装配道具";
  return null;
}

function rerollUnitKind(player: PlayerBattleState, unit: UnitState, rng: Rng) {
  const pool = TOKEN_POOL
    .filter(([kind]) => kind !== unit.kind && kind !== "铲子")
    .map(([kind, weight]) => [kind, weight] as const);
  const index = weightedIndex(rng, pool.map((entry) => entry[1]));
  unit.kind = pool[index]?.[0] ?? "刀";
  unit.secondaryCell = undefined;
  unit.parts = undefined;
  unit.cooldownMs = 0;
  unit.attackCount = 0;
  player.lastEvent = `毛笔改字为「${unit.kind}」`;
}

function validRoadCell(mapIndex: number, cell: number) {
  return Number.isInteger(cell) && cell >= 0 && cell < GAME_CONFIG.rows * GAME_CONFIG.columns && cellCode(mapIndex, cell) === "0_0";
}

function useProp(
  snapshot: MatchSnapshot, player: PlayerBattleState,
  command: Extract<GameCommand, { type: "USE_PROP" }>, rng: Rng,
): string | null {
  const props = ensureProps(player);
  if (!props.loadout.active.includes(command.propId)) return "本局未装配该主动道具";
  const config = PROPS[command.propId];
  if (!config) return "道具配置不存在";
  if ((props.cooldowns[command.propId] ?? 0) > 0) return "道具冷却中";
  if (command.propId === 5 && (props.charges?.[5] ?? 10) <= 0) return "包子已经用完";
  const opponent = snapshot.players[player.slot === 0 ? 1 : 0];
  const ownUnit = command.targetUnitId ? player.units.find((unit) => unit.id === command.targetUnitId) : undefined;

  if ([2, 3, 4, 6, 10].includes(command.propId) && !ownUnit) return "请先选择己方单位";
  if (command.propId === 2 && ownUnit) rerollUnitKind(player, ownUnit, rng);
  if ((command.propId === 3 || command.propId === 4) && ownUnit) {
    const maxLevel = maxLevelForKind(ownUnit.kind);
    if (!maxLevel) return "该文字不能升级";
    if (command.propId === 4) ownUnit.level = Math.min(maxLevel, ownUnit.level + 1);
    else if (ownUnit.level <= 2) ownUnit.level = Math.min(maxLevel, ownUnit.level + 1);
    else {
      const downChance = ownUnit.level === 3 ? 0.3 : 0.4;
      ownUnit.level = rng.next() < downChance ? Math.max(1, ownUnit.level - 1) : Math.min(maxLevel, ownUnit.level + 1);
    }
    ownUnit.cooldownMs = 0;
    ownUnit.attackCount = 0;
    if (GENERALS[ownUnit.kind]) ownUnit.experience = Math.max(
      ownUnit.experience ?? 0,
      generalExperienceFloor(ownUnit.kind, ownUnit.level),
    );
    clearUpgradeDispellable(player, ownUnit);
    player.lastEvent = `${config.name}：${ownUnit.kind}升降至Lv.${ownUnit.level}`;
  }
  if (command.propId === 5) {
    const gain = rng.next() < 0.55;
    player.hp = Math.max(0, player.hp + (gain ? 1 : -1));
    player.maxHp = Math.max(player.maxHp, player.hp);
    props.charges![5] = Math.max(0, (props.charges?.[5] ?? 10) - 1);
    player.lastEvent = gain ? "包子生效：阿斗+1命" : "包子反噬：阿斗-1命";
  }
  if (command.propId === 6 && ownUnit) {
    if (ownUnit.kind !== "弓" && !GENERALS[ownUnit.kind]) return "御敌千里只能用于弓兵或武将";
    ownUnit.rangeMultiplier = 2;
    player.lastEvent = `御敌千里：${ownUnit.kind}射程翻倍`;
  }
  if (command.propId === 7) {
    const target = command.targetEnemyId ? opponent.units.find((unit) => unit.id === command.targetEnemyId) : undefined;
    if (!target) return "请在对方部队中选择砚台落点";
    const origin = cellCoords(target.cell);
    for (const unit of opponent.units) {
      const point = cellCoords(unit.cell);
      if (Math.hypot(point.x - origin.x, point.y - origin.y) <= 1.5) {
        unit.temporaryAttackSpeedMultiplier = 0.8;
        unit.temporaryAttackSpeedMs = 5_000;
      }
    }
    player.lastEvent = "砚台生效：敌方范围攻速-20%，持续5秒";
  }
  if (command.propId === 8 || command.propId === 9) {
    if (command.targetCell === undefined || !validRoadCell(snapshot.mapIndex, command.targetCell)) return "只能放在己方棕色行军路上";
    if (props.placed.some((placed) => placed.cell === command.targetCell)) return "该路格已有陷阱或地雷";
    props.placed.push({ id: `prop-${player.slot}-${snapshot.stateVersion + 1}`, propId: command.propId, cell: command.targetCell });
    player.lastEvent = `${config.name}已放置`;
  }
  if (command.propId === 10 && ownUnit) {
    ownUnit.attackSpeedMultiplier = 1.4;
    player.lastEvent = `攻速符：${ownUnit.kind}攻速+40%`;
  }
  if (command.propId === 21) {
    const item = command.reserveId ? player.reserve.find((candidate) => candidate.id === command.reserveId) : undefined;
    if (!item || item.kind === "铲子") return "请选择营地内要回收的文字";
    player.reserve = player.reserve.filter((candidate) => candidate.id !== item.id);
    player.buns += 1;
    player.lastEvent = `垃圾桶回收「${item.kind}」，+1馒头`;
  }
  props.cooldowns[command.propId] = Math.max(0, config.cooldownMs);
  if (command.propId === 5 && props.charges?.[5] === 0) {
    props.loadout.active = props.loadout.active.filter((id) => id !== 5);
    delete props.cooldowns[5];
  }
  emitBattleEvent(snapshot, {
    type: "prop-used", slot: player.slot, propId: command.propId,
    ...(command.targetUnitId === undefined ? {} : { targetUnitId: command.targetUnitId }),
    ...(command.targetEnemyId === undefined ? {} : { targetEnemyId: command.targetEnemyId }),
    ...(command.targetCell === undefined ? {} : { targetCell: command.targetCell }),
    ...(command.reserveId === undefined ? {} : { reserveId: command.reserveId }),
  });
  return null;
}

function applyRallyBuff(enemy: EnemyState) {
  if ((enemy.battleRallyMs ?? 0) <= 0) {
    const bonus = enemy.maxHp * 0.2;
    enemy.maxHp += bonus;
    enemy.hp += bonus;
    enemy.battleRallyBonusHp = bonus;
  }
  enemy.battleRallyMs = 6_000;
}

function validBattleBuffCell(cell: number) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= GAME_CONFIG.rows * GAME_CONFIG.columns) return false;
  // 对手的权威棋盘同样以自己位于下半场存储；玩家只可投放到其己方半场。
  return cellCoords(cell).y >= GAME_CONFIG.rows / 2;
}

function effectCoversEnemy(snapshot: MatchSnapshot, effect: BattleFieldEffectState, enemy: EnemyState) {
  if (effect.kind !== "smoke" || effect.remainingMs <= 0) return false;
  const center = cellCoords(effect.cell);
  const point = enemyPathPoint(snapshot.mapIndex, enemy);
  const dx = Math.abs(point.x - center.x);
  const dy = Math.abs(point.y - center.y);
  return (dx <= SMOKE_CROSS_RANGE_CELLS && dy <= 0.5)
    || (dy <= SMOKE_CROSS_RANGE_CELLS && dx <= 0.5);
}

function enemyHiddenBySmoke(snapshot: MatchSnapshot, player: PlayerBattleState, enemy: EnemyState) {
  return (player.battleFieldEffects ?? []).some((effect) => effectCoversEnemy(snapshot, effect, enemy));
}

function useBattleBuff(
  snapshot: MatchSnapshot,
  player: PlayerBattleState,
  command: Extract<GameCommand, { type: "USE_BATTLE_BUFF" }>,
): string | null {
  player.battleBuffs ??= [];
  const item = player.battleBuffs.find((candidate) => candidate.id === command.buffInstanceId);
  if (!item) return "该局内BUFF不存在或已经使用";
  const targetSlot: PlayerSlot = player.slot === 0 ? 1 : 0;
  const opponent = snapshot.players[targetSlot];
  const config = BATTLE_BUFFS.find((candidate) => candidate.kind === item.kind);
  if (!config) return "局内BUFF配置不存在";

  if (config.target === "cell") {
    if (command.targetCell === undefined || !validBattleBuffCell(command.targetCell)) return "请拖到对方半场的格子上";
    const targetCell = command.targetCell;
    opponent.battleFieldEffects ??= [];
    if (item.kind === "smoke") {
      const existing = opponent.battleFieldEffects.find((effect) => effect.kind === "smoke" && effect.cell === targetCell);
      if (existing?.kind === "smoke") existing.remainingMs = config.durationMs ?? 6_000;
      else opponent.battleFieldEffects.push({ id: `field-smoke-${item.id}`, kind: "smoke", cell: targetCell, remainingMs: config.durationMs ?? 6_000 });
    } else if (item.kind === "decoy") {
      if (opponent.battleFieldEffects.some((effect) => effect.kind === "decoy" && effect.cell === targetCell)) return "该格子已经有诱敌木桩";
      opponent.battleFieldEffects.push({ id: `field-decoy-${item.id}`, kind: "decoy", cell: targetCell, remainingHits: "maxHits" in config ? config.maxHits : 10 });
    } else {
      return "局内BUFF目标类型不匹配";
    }
    player.battleBuffs = player.battleBuffs.filter((candidate) => candidate.id !== item.id);
    player.lastEvent = `${config.name}已投放到对方棋盘`;
    const affectedEnemyIds = item.kind === "smoke"
      ? opponent.enemies.filter((enemy) => effectCoversEnemy(snapshot, { id: "preview", kind: "smoke", cell: targetCell, remainingMs: config.durationMs ?? 6_000 }, enemy)).map((enemy) => enemy.id)
      : [];
    emitBattleEvent(snapshot, {
      type: "battle-buff-used", slot: player.slot, buffInstanceId: item.id, buffKind: item.kind,
      targetSlot, targetCell, affectedEnemyIds,
    });
    return null;
  }

  const target = command.targetEnemyId
    ? opponent.enemies.find((enemy) => enemy.id === command.targetEnemyId && enemy.hp > 0 && enemy.progress < 1)
    : undefined;
  if (!target) return "请拖到正在进攻对方的怪物身上";
  if (item.kind === "giant" && target.battleGiantApplied) return "该怪物已经获得巨灵效果";

  let affected: EnemyState[] = [target];
  if (item.kind === "invulnerable") target.battleInvulnerableMs = Math.max(target.battleInvulnerableMs ?? 0, 5_000);
  else if (item.kind === "haste") target.battleHasteMs = Math.max(target.battleHasteMs ?? 0, 10_000);
  else if (item.kind === "giant") {
    target.hp *= 2.5;
    target.maxHp *= 2.5;
    if ((target.inspireBonusHp ?? 0) > 0) target.inspireBonusHp = (target.inspireBonusHp ?? 0) * 2.5;
    if ((target.battleRallyBonusHp ?? 0) > 0) target.battleRallyBonusHp = (target.battleRallyBonusHp ?? 0) * 2.5;
    target.battleGiantApplied = true;
  } else if (item.kind === "rally") {
    const center = enemyPathPoint(snapshot.mapIndex, target);
    affected = opponent.enemies.filter((enemy) => {
      if (enemy.hp <= 0 || enemy.progress >= 1) return false;
      const point = enemyPathPoint(snapshot.mapIndex, enemy);
      return Math.hypot(point.x - center.x, point.y - center.y) <= 2;
    });
    for (const enemy of affected) applyRallyBuff(enemy);
  }

  player.battleBuffs = player.battleBuffs.filter((candidate) => candidate.id !== item.id);
  player.lastEvent = `${config?.name ?? "局内BUFF"}已施加给对方怪物`;
  emitBattleEvent(snapshot, {
    type: "battle-buff-used", slot: player.slot, buffInstanceId: item.id, buffKind: item.kind,
    targetSlot, targetEnemyId: target.id, affectedEnemyIds: affected.map((enemy) => enemy.id),
  });
  return null;
}

/**
 * 安装包 nB：只有初始白色布阵格均被占用、营地没有铲子且仍有空位时，
 * 才出现局内铲子补给；一次最多补足两个营地格。
 */
export function shovelSupplyCount(snapshot: MatchSnapshot, player: PlayerBattleState) {
  const props = ensureProps(player);
  if (props.shovelSupplyClaimed || player.reserve.some((item) => item.kind === "铲子")) return 0;
  const occupied = new Set(player.units.flatMap((unit) => unit.secondaryCell === undefined
    ? [unit.cell] : [unit.cell, unit.secondaryCell]));
  if (initialOpenCells(snapshot.mapIndex).some((cell) => !occupied.has(cell))) return 0;
  return Array.from({ length: GAME_CONFIG.reserveSize }, (_, slot) => slot)
    .filter((slot) => !reserveAtSlot(player, slot)).slice(0, 2).length;
}

function claimShovelSupply(snapshot: MatchSnapshot, player: PlayerBattleState): string | null {
  const props = ensureProps(player);
  if (props.shovelSupplyClaimed) return "本局铲子补给已经领取";
  if (player.reserve.some((item) => item.kind === "铲子")) return "营地已有铲子，无需补给";
  const supplyCount = shovelSupplyCount(snapshot, player);
  if (!supplyCount) return "填满初始白色布阵格后才会出现铲子补给";
  const freeSlots = Array.from({ length: GAME_CONFIG.reserveSize }, (_, slot) => slot)
    .filter((slot) => !reserveAtSlot(player, slot)).slice(0, supplyCount);
  const reserveIds: string[] = [];
  for (const targetSlot of freeSlots) {
    const id = `r-${player.slot}-ad-shovel-${snapshot.stateVersion + 1}-${targetSlot}`;
    player.reserve.push({ id, kind: "铲子", level: 1, slot: targetSlot });
    reserveIds.push(id);
  }
  props.shovelSupplyClaimed = true;
  player.lastEvent = `直接领取${freeSlots.length}把铲子（原广告补给）`;
  emitBattleEvent(snapshot, { type: "reserve-granted", slot: player.slot, reserveIds, reason: "shovel-supply" });
  return null;
}

function dispatchCommand(snapshot: MatchSnapshot, player: PlayerBattleState, command: GameCommand): string | null {
  const rng = createRng(snapshot.seed ^ ((snapshot.stateVersion + 1) * 0x9E3779B1) ^ (player.slot * 977));
  switch (command.type) {
    case "RECRUIT": return recruit(snapshot, player, rng);
    case "SET_PROP_LOADOUT": return setPropLoadout(snapshot, player, command.loadout, command.earlyAccountShovelBonus);
    case "USE_PROP": return useProp(snapshot, player, command, rng);
    case "USE_BATTLE_BUFF": return useBattleBuff(snapshot, player, command);
    case "CLAIM_SHOVEL_SUPPLY": return claimShovelSupply(snapshot, player);
    case "CLAIM_BULLDOZER_SUPPLY": return claimBulldozerSupply(snapshot, player);
    case "DROP_RESERVE": return dropReserve(snapshot, player, command.reserveId, command.targetCell);
    case "DROP_RESERVE_TO_SLOT": return dropReserveToSlot(snapshot, player, command.reserveId, command.targetSlot);
    case "DROP_UNIT": return dropUnit(snapshot, player, command.unitId, command.targetCell);
    case "DROP_UNIT_TO_RESERVE": return dropUnitToReserve(snapshot, player, command.unitId, command.targetSlot);
    case "SPLIT_GENERAL": return splitGeneral(snapshot, player, command.unitId, command.partIndex, command.targetCell);
    case "MOVE": return dropUnit(snapshot, player, command.unitId, command.targetCell);
    case "MERGE": return mergeById(snapshot, player, command.sourceId, command.targetId);
    default: return "未知命令";
  }
}

function failure(
  snapshot: MatchSnapshot, commandId: string, code: CommandErrorCode, message: string,
): CommandFailure {
  return { commandId, ok: false, duplicate: false, code, message, stateVersion: snapshot.stateVersion };
}

/**
 * 0.x 本地调用兼容入口。网络和可重试调用应使用 executeCommand，
 * 由完整 CommandEnvelope 提供幂等与乐观并发保护。
 */
export function applyCommand(snapshot: MatchSnapshot, slot: PlayerSlot, command: GameCommand): CommandResult {
  normalizeMatchSnapshot(snapshot);
  if ((slot !== 0 && slot !== 1) || !validGameCommand(command)) {
    return failure(snapshot, "", "ERR_INVALID_COMMAND", "命令格式非法");
  }
  const player = snapshot.players[slot];
  if (snapshot.phase === "finished") return failure(snapshot, "", "ERR_MATCH_ENDED", "对局已结束");

  const draft = cloneSnapshot(snapshot);
  beginTransition(draft);
  const error = dispatchCommand(draft, draft.players[slot], command);
  if (error) return {
    commandId: "", ok: false, duplicate: false,
    code: error === "馒头不足" ? "ERR_NOT_ENOUGH_BUN" : "ERR_INVALID_COMMAND",
    message: error, stateVersion: snapshot.stateVersion,
  };

  beginTransition(snapshot);
  const commitError = dispatchCommand(snapshot, player, command);
  if (commitError) throw new Error(`命令校验与提交结果不一致：${commitError}`);
  snapshot.stateVersion += 1;
  return { commandId: "", ok: true, duplicate: false, stateVersion: snapshot.stateVersion };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.length > 0;
}

function isCellOrSlot(value: unknown) {
  return Number.isSafeInteger(value);
}

function validGameCommand(value: unknown): value is GameCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "RECRUIT":
    case "CLAIM_SHOVEL_SUPPLY":
    case "CLAIM_BULLDOZER_SUPPLY":
      return true;
    case "SET_PROP_LOADOUT": {
      if (!isRecord(value.loadout) || !Array.isArray(value.loadout.active) || !Array.isArray(value.loadout.passive)) return false;
      if (value.earlyAccountShovelBonus !== undefined && typeof value.earlyAccountShovelBonus !== "boolean") return false;
      return value.loadout.active.every((id) => Number.isSafeInteger(id))
        && value.loadout.passive.every((entry) => isRecord(entry) && Number.isSafeInteger(entry.id) && Number.isFinite(entry.level));
    }
    case "USE_PROP":
      return Number.isSafeInteger(value.propId)
        && (value.targetUnitId === undefined || isNonEmptyString(value.targetUnitId))
        && (value.targetEnemyId === undefined || isNonEmptyString(value.targetEnemyId))
        && (value.targetCell === undefined || isCellOrSlot(value.targetCell))
        && (value.reserveId === undefined || isNonEmptyString(value.reserveId));
    case "USE_BATTLE_BUFF":
      return isNonEmptyString(value.buffInstanceId)
        && (value.targetEnemyId === undefined || isNonEmptyString(value.targetEnemyId))
        && (value.targetCell === undefined || isCellOrSlot(value.targetCell))
        && (value.targetEnemyId !== undefined || value.targetCell !== undefined);
    case "DROP_RESERVE":
      return isNonEmptyString(value.reserveId) && isCellOrSlot(value.targetCell);
    case "DROP_RESERVE_TO_SLOT":
      return isNonEmptyString(value.reserveId) && isCellOrSlot(value.targetSlot);
    case "DROP_UNIT":
    case "MOVE":
      return isNonEmptyString(value.unitId) && isCellOrSlot(value.targetCell);
    case "DROP_UNIT_TO_RESERVE":
      return isNonEmptyString(value.unitId) && isCellOrSlot(value.targetSlot);
    case "SPLIT_GENERAL":
      return isNonEmptyString(value.unitId)
        && (value.partIndex === 0 || value.partIndex === 1)
        && isCellOrSlot(value.targetCell);
    case "MERGE":
      return isNonEmptyString(value.sourceId) && isNonEmptyString(value.targetId);
    default:
      return false;
  }
}

function validEnvelope(envelope: CommandEnvelope) {
  return isRecord(envelope)
    && typeof envelope.commandId === "string"
    && envelope.commandId.length > 0
    && envelope.commandId.length <= 128
    && Number.isSafeInteger(envelope.clientSeq)
    && envelope.clientSeq > 0
    && Number.isSafeInteger(envelope.expectedStateVersion)
    && envelope.expectedStateVersion >= 0
    && validGameCommand(envelope.command);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function sameAcceptedCommand(record: MatchSnapshot["acceptedCommands"][string], slot: PlayerSlot, envelope: CommandEnvelope) {
  return record.slot === slot
    && record.clientSeq === envelope.clientSeq
    && record.expectedStateVersion === envelope.expectedStateVersion
    && canonicalJson(record.command) === canonicalJson(envelope.command);
}

/** 权威命令入口：校验版本和席位序号，并把成功命令的幂等记录持久化进快照。 */
export function executeCommand(snapshot: MatchSnapshot, slot: PlayerSlot, envelope: CommandEnvelope): CommandResult {
  normalizeMatchSnapshot(snapshot);
  if ((slot !== 0 && slot !== 1) || !validEnvelope(envelope)) {
    return failure(snapshot, isRecord(envelope) && typeof envelope.commandId === "string" ? envelope.commandId : "", "ERR_INVALID_ENVELOPE", "命令信封格式非法");
  }

  const accepted = Object.prototype.hasOwnProperty.call(snapshot.acceptedCommands, envelope.commandId)
    ? snapshot.acceptedCommands[envelope.commandId]
    : undefined;
  if (accepted) {
    if (!sameAcceptedCommand(accepted, slot, envelope)) {
      return failure(snapshot, envelope.commandId, "ERR_COMMAND_ID_CONFLICT", "命令 ID 已被另一意图使用");
    }
    return { ...accepted.result, duplicate: true };
  }
  if (envelope.expectedStateVersion > snapshot.stateVersion) {
    return failure(snapshot, envelope.commandId, "ERR_STATE_VERSION", "命令引用了尚不存在的状态版本");
  }
  if (envelope.clientSeq <= snapshot.lastClientSeq[slot]) {
    return failure(snapshot, envelope.commandId, "ERR_CLIENT_SEQUENCE", "客户端命令序号重复或倒退");
  }

  const applied = applyCommand(snapshot, slot, envelope.command);
  if (!applied.ok) return { ...applied, commandId: envelope.commandId };
  const result = { ...applied, commandId: envelope.commandId };

  snapshot.lastClientSeq[slot] = envelope.clientSeq;
  Object.defineProperty(snapshot.acceptedCommands, envelope.commandId, {
    configurable: true, enumerable: true, writable: true,
    value: {
      slot, clientSeq: envelope.clientSeq, expectedStateVersion: envelope.expectedStateVersion,
      command: structuredClone(envelope.command), result: { ...result },
    },
  });
  trimAcceptedCommands(snapshot);
  return result;
}

function spawnEnemy(snapshot: MatchSnapshot, player: PlayerBattleState) {
  const waveIndex = player.wave - 1;
  const wave = WAVES[waveIndex] ?? WAVES[0];
  const curve = DIFFICULTY_CURVES[snapshot.difficultyCurve] ?? DIFFICULTY_CURVES[0];
  const multiplier = curve[waveIndex] ?? 1;
  const isLastSpawn = player.remainingToSpawn === 1;
  const boss = isLastSpawn && snapshot.bossWaves.includes(player.wave);
  const introRound = Math.max(0, Math.floor(player.introRound ?? 10));
  const introMultiplier = player.wave <= 10 && introRound < INTRO_ROUND_HP_MULTIPLIERS.length
    ? INTRO_ROUND_HP_MULTIPLIERS[introRound] ?? 1 : 1;
  const baseHp = wave[1] * multiplier * introMultiplier;
  const bossOrdinal = snapshot.bossWaves.filter((bossWave) => bossWave <= player.wave).length - 1;
  const bossType = boss ? snapshot.mapIndex * 3 + Math.max(0, bossOrdinal) % 3 : undefined;
  const bossConfig = bossType === undefined ? undefined : BOSS_CONFIGS[bossType];
  const hp = baseHp * (bossConfig?.hpMultiplier ?? 1);
  const route = expandedPath(snapshot.mapIndex);
  const spawn = route[0] ?? { x: 0, y: 0 };
  player.enemies.push({
    id: `e-${player.slot}-${player.wave}-${player.remainingToSpawn}-${snapshot.tick}`,
    hp, maxHp: hp, progress: 0, boss, ...(bossType === undefined ? {} : { bossType }), stunnedMs: 0,
    pathX: spawn.x, pathY: spawn.y, pathIndex: Math.min(1, Math.max(0, route.length - 1)),
    ...(boss ? { bossCooldownMs: 0, scaleMultiplier: 1 } : {}),
  });
  player.remainingToSpawn -= 1;
}

function damage(enemy: PlayerBattleState["enemies"][number], amount: number) {
  if ((enemy.battleInvulnerableMs ?? 0) > 0) return 0;
  enemy.hp -= amount;
  return amount;
}

function maybeDropBattleBuff(snapshot: MatchSnapshot, player: PlayerBattleState, enemy: EnemyState): BattleBuffKind | null {
  if (enemy.boss) return null;
  const rng = createRng(snapshot.seed ^ snapshot.tick ^ stringSeed(enemy.id) ^ (player.slot * 0x45D9F3B) ^ 0xB0FF);
  if (rng.next() >= BATTLE_BUFF_DROP.chance) return null;
  const config = BATTLE_BUFFS[Math.floor(rng.next() * BATTLE_BUFFS.length)]!;
  const id = `buff-${player.slot}-${enemy.id}`;
  player.battleBuffs ??= [];
  if (player.battleBuffs.some((item) => item.id === id)) return null;
  player.battleBuffs.push({ id, kind: config.kind });
  emitBattleEvent(snapshot, {
    type: "battle-buff-dropped", slot: player.slot, buffInstanceId: id,
    buffKind: config.kind, sourceEnemyId: enemy.id,
  });
  return config.kind;
}

function emitGeneralSkill(snapshot: MatchSnapshot, player: PlayerBattleState, unit: UnitState, skillName: GeneralSkillName, targetId?: string) {
  emitBattleEvent(snapshot, {
    type: "general-skill", slot: player.slot, unitId: unit.id, unitKind: unit.kind, skillName,
    sourceCell: unit.cell, ...(unit.secondaryCell === undefined ? {} : { secondaryCell: unit.secondaryCell }),
    ...(targetId === undefined ? {} : { targetId }),
  });
}

function queueGeneralImpact(player: PlayerBattleState, unit: UnitState, impact: Omit<PendingGeneralImpactState, "sourceCell" | "secondaryCell">) {
  player.pendingGeneralImpacts ??= [];
  player.pendingGeneralImpacts.push({
    ...impact, sourceCell: unit.cell,
    ...(unit.secondaryCell === undefined ? {} : { secondaryCell: unit.secondaryCell }),
  });
}

function scheduleJumpSlash(snapshot: MatchSnapshot, player: PlayerBattleState, unit: UnitState, damageValue: number, strikes: number) {
  const config = unit.kind === "关羽" ? GENERAL_SKILLS.关羽 : GENERAL_SKILLS.张翼;
  const playback = 1 + 0.2 * unit.level;
  const initialTarget = [...player.enemies].filter((enemy) => enemy.hp > 0).sort((a, b) => b.progress - a.progress)[0];
  if (!initialTarget) return;
  emitGeneralSkill(snapshot, player, unit, "跳斩", initialTarget.id);
  unit.generalSkillLockMs = strikes * 500 / playback + 500 / (0.8 * playback);
  for (let strike = 0; strike < strikes; strike += 1) {
    queueGeneralImpact(player, unit, {
      id: `jump-slash-${unit.id}-${snapshot.tick}-${strike}`, unitId: unit.id, unitKind: unit.kind,
      skillName: "跳斩", kind: "jump-slash", targetId: initialTarget.id, damage: damageValue,
      remainingMs: (strike + 1) * 500 / playback,
      splashRadiusCells: config.splashRadiusCells, splashDamageMultiplier: config.splashDamageMultiplier,
    });
  }
}

function scheduleHuangZuArrowRain(
  snapshot: MatchSnapshot, player: PlayerBattleState, unit: UnitState, damageValue: number, targets: EnemyState[],
) {
  const config = GENERAL_SKILLS.黄祖;
  const fallback = [...player.enemies].filter((enemy) => enemy.hp > 0).sort((a, b) => b.progress - a.progress)[0];
  if (!targets.length && !fallback) return;
  emitGeneralSkill(snapshot, player, unit, config.name, (targets[0] ?? fallback)?.id);
  unit.generalSkillLockMs = (config.rounds - 1) * 500;
  const rng = createRng(snapshot.seed ^ snapshot.tick ^ stringSeed(unit.id) ^ 0x485A);
  for (let round = 0; round < config.rounds; round += 1) {
    for (let arrow = 1; arrow <= config.arrowsPerRound; arrow += 1) {
      const target = targets.length < config.arrowsPerRound
        ? targets[arrow % targets.length] ?? fallback
        : targets[Math.floor(rng.next() * targets.length)] ?? fallback;
      if (!target) continue;
      queueGeneralImpact(player, unit, {
        id: `huangzu-arrow-${unit.id}-${snapshot.tick}-${round}-${arrow}`, unitId: unit.id, unitKind: unit.kind,
        skillName: config.name, kind: "huangzu-arrow", targetId: target.id, damage: damageValue,
        // 原包各箭追踪 1000–1199ms；每一轮由上一轮射击动画结束后继续。
        remainingMs: round * 500 + config.projectileDelayMs + Math.floor(rng.next() * config.projectileDelayRangeMs),
      });
    }
  }
}

function scheduleHolySword(
  snapshot: MatchSnapshot, player: PlayerBattleState, unit: UnitState, damageValue: number, target: EnemyState,
) {
  const config = GENERAL_SKILLS.刘备;
  emitGeneralSkill(snapshot, player, unit, config.name, target.id);
  const first = cellCoords(unit.cell);
  const second = unit.secondaryCell === undefined ? first : cellCoords(unit.secondaryCell);
  const source = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const targetPoint = enemyPathPoint(snapshot.mapIndex, target);
  const dx = targetPoint.x - source.x; const dy = targetPoint.y - source.y;
  const length = Math.max(0.0001, Math.hypot(dx, dy));
  const direction = { x: dx / length, y: dy / length };
  const hitTargets = player.enemies.filter((enemy) => {
    if (enemy.hp <= 0) return false;
    const point = enemyPathPoint(snapshot.mapIndex, enemy);
    const offsetX = point.x - source.x; const offsetY = point.y - source.y;
    const forward = offsetX * direction.x + offsetY * direction.y;
    const perpendicular = Math.abs(offsetX * direction.y - offsetY * direction.x);
    return forward >= 0 && perpendicular <= 0.7;
  });
  for (const [index, enemy] of hitTargets.entries()) {
    const point = enemyPathPoint(snapshot.mapIndex, enemy);
    const distancePx = Math.hypot(point.x - source.x, point.y - source.y) * ORIGINAL_CELL_PX;
    queueGeneralImpact(player, unit, {
      id: `holy-sword-${unit.id}-${snapshot.tick}-${index}`, unitId: unit.id, unitKind: unit.kind,
      skillName: config.name, kind: "holy-sword", targetId: enemy.id,
      damage: damageValue * config.damageMultiplier, remainingMs: distancePx / 300, stunMs: config.knockdownMs,
    });
  }
}

function scheduleZhaoPhantom(snapshot: MatchSnapshot, player: PlayerBattleState, unit: UnitState, damageValue: number) {
  const target = [...player.enemies].filter((enemy) => enemy.hp > 0).sort((a, b) => b.progress - a.progress)[0];
  if (!target) return;
  const path = expandedPath(snapshot.mapIndex);
  const pathIndex = Math.max(1, Math.min(path.length - 1, target.pathIndex ?? Math.floor(target.progress * (path.length - 1))));
  const point = path[pathIndex]!;
  emitGeneralSkill(snapshot, player, unit, GENERAL_SKILLS.赵云.name, target.id);
  player.zhaoPhantoms ??= [];
  player.zhaoPhantoms.push({
    id: `zhao-phantom-${unit.id}-${snapshot.tick}`, unitId: unit.id, unitKind: "赵云",
    x: point.x, y: point.y, pathIndex, direction: -1, roundTrips: 0,
    pulseMs: GENERAL_SKILLS.赵云.pulseMs, launchMs: 500, damage: damageValue, hitEnemyIds: [],
  });
}

function tickGeneralImpacts(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  const remaining: PendingGeneralImpactState[] = [];
  for (const impact of player.pendingGeneralImpacts ?? []) {
    impact.remainingMs -= deltaMs;
    if (impact.remainingMs > 0) { remaining.push(impact); continue; }
    let target = player.enemies.find((enemy) => enemy.id === impact.targetId && enemy.hp > 0
      && !enemyHiddenBySmoke(snapshot, player, enemy));
    if (impact.kind === "jump-slash") {
      target = [...player.enemies].filter((enemy) => enemy.hp > 0 && !enemyHiddenBySmoke(snapshot, player, enemy))
        .sort((a, b) => b.progress - a.progress)[0];
    }
    if (!target) continue;
    const aliveBeforeImpact = new Set(player.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.id));
    const applied = damage(target, impact.damage);
    let hitCount = 1;
    if (impact.splashRadiusCells && impact.splashDamageMultiplier) {
      const center = enemyPathPoint(snapshot.mapIndex, target);
      for (const enemy of player.enemies) {
        if (enemy.id === target.id || enemy.hp <= 0 || enemyHiddenBySmoke(snapshot, player, enemy)) continue;
        if (!attackRangeIntersectsCell(center, enemyPathPoint(snapshot.mapIndex, enemy), impact.splashRadiusCells)) continue;
        damage(enemy, impact.damage * impact.splashDamageMultiplier); hitCount += 1;
      }
    }
    if (impact.stunMs) target.stunnedMs = Math.max(target.stunnedMs, impact.stunMs);
    emitBattleEvent(snapshot, {
      type: "attack", slot: player.slot, unitId: impact.unitId, unitKind: impact.unitKind,
      sourceCell: impact.sourceCell, ...(impact.secondaryCell === undefined ? {} : { secondaryCell: impact.secondaryCell }),
      targetId: target.id, targetProgress: target.progress, targetBoss: target.boss,
      damage: applied, hitCount, special: true, skillName: impact.skillName,
    });
    const general = player.units.find((unit) => unit.id === impact.unitId);
    if (general) grantGeneralExperienceForNewDefeats(snapshot, player, general, aliveBeforeImpact);
  }
  player.pendingGeneralImpacts = remaining;
}

function tickZhaoPhantoms(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  const path = expandedPath(snapshot.mapIndex);
  const remaining: ZhaoPhantomState[] = [];
  for (const phantom of player.zhaoPhantoms ?? []) {
    phantom.launchMs = Math.max(0, phantom.launchMs - deltaMs);
    if (phantom.launchMs > 0) { remaining.push(phantom); continue; }
    let distanceCells = GENERAL_SKILLS.赵云.phantomSpeedPxPerSec * deltaMs / 1_000 / ORIGINAL_CELL_PX;
    while (distanceCells > 0 && phantom.roundTrips < GENERAL_SKILLS.赵云.roundTrips) {
      const nextIndex = phantom.pathIndex + phantom.direction;
      if (nextIndex < 0) { phantom.direction = 1; phantom.hitEnemyIds = []; continue; }
      if (nextIndex >= path.length) {
        phantom.roundTrips += 1; phantom.hitEnemyIds = [];
        if (phantom.roundTrips >= GENERAL_SKILLS.赵云.roundTrips) break;
        phantom.direction = -1; continue;
      }
      const next = path[nextIndex]!;
      const segment = Math.hypot(next.x - phantom.x, next.y - phantom.y);
      if (segment <= distanceCells) {
        phantom.x = next.x; phantom.y = next.y; phantom.pathIndex = nextIndex; distanceCells -= segment;
      } else {
        phantom.x += (next.x - phantom.x) / segment * distanceCells;
        phantom.y += (next.y - phantom.y) / segment * distanceCells;
        distanceCells = 0;
      }
    }
    phantom.pulseMs -= deltaMs;
    if (phantom.pulseMs <= 0 && phantom.roundTrips < GENERAL_SKILLS.赵云.roundTrips) {
      phantom.pulseMs += GENERAL_SKILLS.赵云.pulseMs;
      const targets = player.enemies.filter((enemy) => enemy.hp > 0 && !enemyHiddenBySmoke(snapshot, player, enemy)
        && Math.hypot(enemyPathPoint(snapshot.mapIndex, enemy).x - phantom.x, enemyPathPoint(snapshot.mapIndex, enemy).y - phantom.y) <= 0.75);
      const aliveBeforePulse = new Set(player.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.id));
      for (const target of targets) damage(target, phantom.damage);
      phantom.hitEnemyIds = targets.map((target) => target.id);
      const target = targets[0];
      if (target) {
        emitBattleEvent(snapshot, {
          type: "attack", slot: player.slot, unitId: phantom.unitId, unitKind: phantom.unitKind,
          sourceCell: 0, sourceX: phantom.x, sourceY: phantom.y,
          targetId: target.id, targetProgress: target.progress, targetBoss: target.boss,
          damage: phantom.damage, hitCount: targets.length, special: true, skillName: "七进七出",
        });
        const general = player.units.find((unit) => unit.id === phantom.unitId);
        if (general) grantGeneralExperienceForNewDefeats(snapshot, player, general, aliveBeforePulse);
      }
    }
    if (phantom.roundTrips < GENERAL_SKILLS.赵云.roundTrips) remaining.push(phantom);
  }
  player.zhaoPhantoms = remaining;
}

function attack(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  const opponent = snapshot.players[player.slot === 0 ? 1 : 0];
  for (const unit of player.units) {
    if ((unit.bossChaosMs ?? 0) > 0 || (unit.bossLockedMs ?? 0) !== 0 || (unit.generalSkillLockMs ?? 0) > 0) continue;
    const stats = unitStats(unit, player, opponent);
    if (!stats) continue;
    // 空窗期只让冷却恢复到“可攻击”，绝不能积累负冷却债务；否则敌人
    // 入射程后会每个 Tick 补发一次历史攻击。保留本 Tick 的少量超时量，
    // 让固定步长下的平均攻击间隔继续贴近配置值。
    const elapsedCooldown = Math.max(0, unit.cooldownMs) - deltaMs;
    unit.cooldownMs = Math.max(0, elapsedCooldown);
    const firstPosition = cellCoords(unit.cell);
    const secondPosition = unit.secondaryCell === undefined ? firstPosition : cellCoords(unit.secondaryCell);
    const position = { x: (firstPosition.x + secondPosition.x) / 2, y: (firstPosition.y + secondPosition.y) / 2 };
    const decoy = [...(player.battleFieldEffects ?? [])]
      .filter((effect): effect is Extract<BattleFieldEffectState, { kind: "decoy" }> => effect.kind === "decoy"
        && effect.remainingHits > 0 && attackRangeIntersectsCell(position, cellCoords(effect.cell), stats.range))
      .sort((a, b) => {
        const pa = cellCoords(a.cell); const pb = cellCoords(b.cell);
        return Math.hypot(pa.x - position.x, pa.y - position.y) - Math.hypot(pb.x - position.x, pb.y - position.y)
          || a.id.localeCompare(b.id);
      })[0];
    if (decoy) {
      if (elapsedCooldown > 0) continue;
      decoy.remainingHits -= 1;
      unit.attackCount += 1;
      unit.cooldownMs = Math.max(0, stats.intervalMs + elapsedCooldown);
      if (unit.kind === "关羽") {
        unit.repeatedTargetId = decoy.id;
        unit.repeatedTargetAttackBonus = 0;
      }
      emitBattleEvent(snapshot, {
        type: "battle-field-effect-hit", slot: player.slot, effectId: decoy.id, effectKind: "decoy",
        unitId: unit.id, unitKind: unit.kind, sourceCell: unit.cell,
        ...(unit.secondaryCell === undefined ? {} : { secondaryCell: unit.secondaryCell }),
        targetCell: decoy.cell, remainingHits: decoy.remainingHits,
      });
      if (decoy.remainingHits <= 0) {
        player.battleFieldEffects = (player.battleFieldEffects ?? []).filter((effect) => effect.id !== decoy.id);
        player.lastEvent = "诱敌木桩已被击破";
      }
      continue;
    }
    if (player.enemies.length === 0) continue;
    const inRange = player.enemies.filter((enemy) => {
      if (enemy.hp <= 0 || enemyHiddenBySmoke(snapshot, player, enemy)) return false;
      const point = enemyPathPoint(snapshot.mapIndex, enemy);
      return attackRangeIntersectsCell(position, point, stats.range);
    });
    if (inRange.length === 0 || elapsedCooldown > 0) continue;
    const hero = GENERALS[unit.kind];
    const targetsClosestEnd = hero ? hero.target === "closest-end" : unit.kind === "弓";
    const target = targetsClosestEnd
      ? [...inRange].sort((a, b) => b.progress - a.progress)[0]!
      : [...inRange].sort((a, b) => {
          const pa = enemyPathPoint(snapshot.mapIndex, a); const pb = enemyPathPoint(snapshot.mapIndex, b);
          return Math.hypot(pa.x - position.x, pa.y - position.y) - Math.hypot(pb.x - position.x, pb.y - position.y);
        })[0]!;
    let attackValue = stats.attack;
    if (unit.kind === "关羽") {
      if (unit.repeatedTargetId === target.id) {
        unit.repeatedTargetAttackBonus = Math.min(
          (unit.repeatedTargetAttackBonus ?? 0) + GENERAL_SKILLS.关羽.repeatAttackStep,
          GENERAL_SKILLS.关羽.repeatAttackMaximum,
        );
      } else {
        unit.repeatedTargetId = target.id;
        unit.repeatedTargetAttackBonus = 0;
      }
      attackValue *= 1 + (unit.repeatedTargetAttackBonus ?? 0);
    }
    const aliveBeforeAttack = new Set(player.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.id));

    // 原包 ta：关羽/张翼在累计普攻后的“下一次攻击”以跳斩替代普攻；
    // 每次跳斩主目标 100%，目标周围 2.5 格再承受 50% 溅射。
    const jumpSlashCount = unit.kind === "关羽" && unit.attackCount >= GENERAL_SKILLS.关羽.attacks ? GENERAL_SKILLS.关羽.strikes
      : unit.kind === "张翼" && unit.attackCount >= GENERAL_SKILLS.张翼.attacks ? GENERAL_SKILLS.张翼.strikes : 0;
    if (jumpSlashCount > 0) {
      unit.attackCount = 0;
      unit.cooldownMs = Math.max(0, stats.intervalMs + elapsedCooldown);
      scheduleJumpSlash(snapshot, player, unit, attackValue, jumpSlashCount);
      continue;
    }

    // 原包 eC 技能在计数达到阈值后的下一次攻击前释放；随后衔接的普攻不累计下一轮计数。
    const shoutStunMs = unit.kind === "张飞" && unit.attackCount >= GENERAL_SKILLS.张飞.attacks ? GENERAL_SKILLS.张飞.stunMs
      : unit.kind === "关平" && unit.attackCount >= GENERAL_SKILLS.关平.attacks ? GENERAL_SKILLS.关平.stunMs : 0;
    const fireArrowRain = unit.kind === "黄忠" && unit.attackCount >= GENERAL_SKILLS.黄忠.attacks;
    const arrowRain = unit.kind === "黄祖" && unit.attackCount >= GENERAL_SKILLS.黄祖.attacks;
    const preAttackSkill = shoutStunMs > 0 || fireArrowRain || arrowRain;
    if (preAttackSkill) unit.attackCount = 0;

    const baseDamage = unit.kind === "骑" ? attackValue / 2 : attackValue;
    const normalStrikeCount = unit.kind === "赵云" ? GENERAL_SKILLS.赵云.normalThrusts : 1;
    let appliedBaseDamage = 0;
    for (let strike = 0; strike < normalStrikeCount; strike += 1) appliedBaseDamage += damage(target, baseDamage);
    if (!preAttackSkill) unit.attackCount += 1;
    unit.cooldownMs = Math.max(0, stats.intervalMs + elapsedCooldown);
    const effect = emitBattleEvent(snapshot, {
      type: "attack",
      slot: player.slot,
      unitId: unit.id,
      unitKind: unit.kind,
      sourceCell: unit.cell,
      ...(unit.secondaryCell === undefined ? {} : { secondaryCell: unit.secondaryCell }),
      targetId: target.id,
      targetProgress: target.progress,
      targetBoss: target.boss,
      damage: appliedBaseDamage,
      hitCount: normalStrikeCount,
      special: false,
    } as Extract<BattleEventPayload, { type: "attack" }>);

    const form = hero?.form ?? SOLDIERS[unit.kind as keyof typeof SOLDIERS]?.form;
    if (unit.kind === "枪" || form?.includes("贯穿")) {
      const targetPoint = enemyPathPoint(snapshot.mapIndex, target);
      for (const enemy of inRange) if (enemy.id !== target.id) {
        const point = enemyPathPoint(snapshot.mapIndex, enemy);
        if (!pikeThrustIntersectsCell(position, targetPoint, point)) continue;
        for (let strike = 0; strike < normalStrikeCount; strike += 1) damage(enemy, attackValue);
        effect.hitCount += normalStrikeCount;
      }
    }
    if (unit.kind === "骑") {
      for (const enemy of inRange) {
        if (enemy.id !== target.id) {
          damage(enemy, stats.attack / 2);
          effect.hitCount += 1;
        }
        const point = enemyPathPoint(snapshot.mapIndex, enemy);
        if (attackRangeIntersectsCell(position, point, stats.range / 2)) {
          damage(enemy, stats.attack / 2);
          effect.hitCount += 1;
        }
      }
    }
    if (hero?.form === "范围") {
      for (const enemy of inRange) if (enemy.id !== target.id) {
        damage(enemy, stats.attack);
        effect.hitCount += 1;
      }
    }
    if (shoutStunMs > 0) {
      for (const enemy of inRange) enemy.stunnedMs = Math.max(enemy.stunnedMs, shoutStunMs);
      emitGeneralSkill(snapshot, player, unit, "大喝", target.id);
      effect.special = true;
      effect.hitCount = Math.max(effect.hitCount, inRange.length);
    }
    if (unit.kind === "张飞") {
      for (const enemy of inRange) {
        enemy.generalSlowMultiplier = GENERAL_SKILLS.张飞.slowMultiplier;
        enemy.generalSlowMs = Math.max(enemy.generalSlowMs ?? 0, GENERAL_SKILLS.张飞.slowMs);
      }
    }
    if (fireArrowRain) {
      // 原包 Na.TF/_R：整条 A* 路径逐格生成、洗牌并逐箭结算落点。
      emitGeneralSkill(snapshot, player, unit, GENERAL_SKILLS.黄忠.name, target.id);
      scheduleHuangZhongArrowRain(snapshot, player, unit, attackValue);
      effect.special = true;
    }
    if (arrowRain) {
      // 原包 qa(30)：5 轮、每轮 10 箭；不足 10 个目标时按当前射程列表循环分配。
      scheduleHuangZuArrowRain(snapshot, player, unit, attackValue, inRange);
      effect.special = true;
    }
    if (unit.kind === "赵云" && unit.attackCount >= GENERAL_SKILLS.赵云.attacks) {
      scheduleZhaoPhantom(snapshot, player, unit, attackValue);
      effect.special = true;
      unit.attackCount = 0;
    }
    if (unit.kind === "刘备" && unit.attackCount >= GENERAL_SKILLS.刘备.attacks) {
      scheduleHolySword(snapshot, player, unit, attackValue, target);
      effect.special = true;
      unit.attackCount = 0;
    }
    if (unit.kind === "马超") {
      const skill = GENERAL_SKILLS.马超;
      const chance = target.boss ? skill.bossChance : skill.normalChance;
      const roll = createRng(snapshot.seed ^ snapshot.tick ^ unit.attackCount ^ unit.id.length).next();
      if (roll < chance) {
        target.stunnedMs = Math.max(target.stunnedMs, target.boss ? skill.bossStunMs : skill.normalStunMs);
        effect.damage += damage(target, target.maxHp * (target.boss ? skill.bossMaxHpDamage : skill.normalMaxHpDamage));
        effect.special = true; effect.skillName = skill.name;
      }
    }
    if ((unit.kind === "关兴" || unit.kind === "张苞") && !target.boss) {
      const roll = createRng(snapshot.seed ^ snapshot.tick ^ unit.attackCount ^ unit.id.length ^ 0x109).next();
      const skill = GENERAL_SKILLS[unit.kind];
      if (roll < skill.chance) { target.stunnedMs = Math.max(target.stunnedMs, skill.stunMs); effect.special = true; effect.skillName = skill.name; }
    }
    grantGeneralExperienceForNewDefeats(snapshot, player, unit, aliveBeforeAttack);
  }
  const defeated = player.enemies.filter((enemy) => enemy.hp <= 0);
  if (defeated.length) {
    for (const fallen of defeated) {
      if (fallen.boss) continue;
      const necromancer = player.enemies.find((enemy) => enemy.bossType === 1
        && enemy.bossSkillElapsedMs !== undefined && (enemy.resurrectionRemaining ?? 0) > 0
        && attackRangeIntersectsCell(enemyPathPoint(snapshot.mapIndex, enemy), enemyPathPoint(snapshot.mapIndex, fallen), BOSS_CONFIGS[1].range));
      if (necromancer) {
        necromancer.resurrectionRemaining = Math.max(0, (necromancer.resurrectionRemaining ?? 0) - 1);
        spawnSummonedEnemy(snapshot, player, "zombie", fallen);
      }
    }
    player.enemies = player.enemies.filter((enemy) => enemy.hp > 0);
    const reward = defeated.reduce((sum, enemy) => sum + (enemy.boss ? GAME_CONFIG.bossKillBuns : GAME_CONFIG.normalKillBuns), 0);
    player.buns += reward;
    const dropped: BattleBuffKind[] = [];
    for (const enemy of defeated) {
      emitBattleEvent(snapshot, {
        type: "enemy-defeated", slot: player.slot, enemyId: enemy.id, boss: enemy.boss,
        rewardBuns: enemy.boss ? GAME_CONFIG.bossKillBuns : GAME_CONFIG.normalKillBuns,
      });
      const buff = maybeDropBattleBuff(snapshot, player, enemy);
      if (buff) dropped.push(buff);
    }
    for (const deadBoss of defeated.filter((enemy) => enemy.bossType === 4)) {
      player.rainBossIds = (player.rainBossIds ?? []).filter((id) => id !== deadBoss.id);
    }
    const droppedNames = dropped.map((kind) => BATTLE_BUFFS.find((buff) => buff.kind === kind)?.name).filter(Boolean);
    const rewardText = defeated.some((enemy) => enemy.boss) ? `击败Boss，+${reward}馒头` : `击败敌人，+${reward}馒头`;
    player.lastEvent = droppedNames.length ? `${rewardText} · 掉落${droppedNames.join("、")}` : rewardText;
  }
}

function firstEmptyReserveSlot(player: PlayerBattleState) {
  for (let slot = 0; slot < GAME_CONFIG.reserveSize; slot += 1) if (!reserveAtSlot(player, slot)) return slot;
  return null;
}

function expandedPath(mapIndex: number) {
  const source = MAP_LAYOUTS[mapIndex]?.path ?? MAP_LAYOUTS[0]!.path;
  const result: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < source.length; index += 1) {
    const point = source[index]!;
    const previous = source[index - 1];
    if (!previous) { result.push({ x: point[0], y: point[1] }); continue; }
    const dx = Math.sign(point[0] - previous[0]);
    const dy = Math.sign(point[1] - previous[1]);
    const steps = Math.max(Math.abs(point[0] - previous[0]), Math.abs(point[1] - previous[1]));
    for (let step = 1; step <= steps; step += 1) result.push({ x: previous[0] + dx * step, y: previous[1] + dy * step });
  }
  return result;
}

function generalPartAtCell(target: UnitState, targetCell: number) {
  if (target.secondaryCell === undefined || !GENERALS[target.kind]) return null;
  const parts = target.parts ?? [target.kind[0] ?? "", target.kind[1] ?? ""];
  if (targetCell === target.cell) return parts[0] ?? null;
  if (targetCell === target.secondaryCell) return parts[1] ?? null;
  return null;
}

function generalPartAtSlot(target: ReserveItem, targetSlot: number) {
  if (target.secondarySlot === undefined || !GENERALS[target.kind]) return null;
  const parts = target.parts ?? [target.kind[0] ?? "", target.kind[1] ?? ""];
  if (targetSlot === target.slot) return parts[0] ?? null;
  if (targetSlot === target.secondarySlot) return parts[1] ?? null;
  return null;
}

function upgradeGeneralWithMatchingPart(player: PlayerBattleState, source: { kind: string; level: number }, target: UnitState, targetCell: number) {
  const part = generalPartAtCell(target, targetCell);
  if (part !== source.kind) return { matched: false as const };
  if (source.level !== target.level) return { matched: true as const, error: "同字与武将必须同级才能升级" };
  const maxLevel = maxLevelForKind(target.kind);
  if (!maxLevel || target.level >= maxLevel) return { matched: true as const, error: "武将已满级" };
  target.level += 1; target.cooldownMs = 0; target.attackCount = 0;
  target.experience = generalExperienceFloor(target.kind, target.level);
  clearUpgradeDispellable(player, target);
  return { matched: true as const, error: null };
}

function replaceGeneralPart(source: { kind: string; level: number }, target: UnitState, targetCell: number) {
  if (target.secondaryCell === undefined || !GENERALS[target.kind]) return { matched: false as const };
  const parts = [...(target.parts ?? [target.kind[0] ?? "", target.kind[1] ?? ""])] as [string, string];
  const partIndex: 0 | 1 | null = targetCell === target.cell ? 0 : targetCell === target.secondaryCell ? 1 : null;
  if (partIndex === null || parts[partIndex] === source.kind) return { matched: false as const };
  const displacedKind = parts[partIndex];
  parts[partIndex] = source.kind;
  const hero = HERO_PAIRS[`${parts[0]}+${parts[1]}`];
  if (!hero) return { matched: false as const };
  return { matched: true as const, hero, parts, displacedKind, displacedLevel: target.level };
}

function replaceReserveGeneralPart(source: { kind: string; level: number }, target: ReserveItem, targetSlot: number) {
  if (target.secondarySlot === undefined || !GENERALS[target.kind]) return { matched: false as const };
  const parts = [...(target.parts ?? [target.kind[0] ?? "", target.kind[1] ?? ""])] as [string, string];
  const partIndex: 0 | 1 | null = targetSlot === target.slot ? 0 : targetSlot === target.secondarySlot ? 1 : null;
  if (partIndex === null || parts[partIndex] === source.kind) return { matched: false as const };
  const displacedKind = parts[partIndex];
  parts[partIndex] = source.kind;
  const hero = HERO_PAIRS[`${parts[0]}+${parts[1]}`];
  if (!hero) return { matched: false as const };
  return { matched: true as const, hero, parts, displacedKind, displacedLevel: target.level };
}

function upgradeReserveGeneralWithMatchingPart(source: { kind: string; level: number }, target: ReserveItem, targetSlot: number) {
  const part = generalPartAtSlot(target, targetSlot);
  if (part !== source.kind) return { matched: false as const };
  if (source.level !== target.level) return { matched: true as const, error: "同字与武将必须同级才能升级" };
  const maxLevel = maxLevelForKind(target.kind);
  if (!maxLevel || target.level >= maxLevel) return { matched: true as const, error: "武将已满级" };
  target.level += 1;
  target.experience = generalExperienceFloor(target.kind, target.level);
  return { matched: true as const, error: null };
}

function stringSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function ensureEnemyMovement(mapIndex: number, enemy: EnemyState) {
  if (Number.isFinite(enemy.pathX) && Number.isFinite(enemy.pathY) && Number.isInteger(enemy.pathIndex)) return;
  const route = expandedPath(mapIndex);
  const segments = Math.max(1, route.length - 1);
  const distance = Math.max(0, Math.min(1, enemy.progress)) * segments;
  const fromIndex = Math.min(route.length - 2, Math.floor(distance));
  const fraction = distance - fromIndex;
  const from = route[fromIndex] ?? route[0] ?? { x: 0, y: 0 };
  const to = route[fromIndex + 1] ?? from;
  enemy.pathX = from.x + (to.x - from.x) * fraction;
  enemy.pathY = from.y + (to.y - from.y) * fraction;
  enemy.pathIndex = Math.min(route.length - 1, Math.max(1, Math.ceil(distance)));
}

function syncEnemyProgress(mapIndex: number, enemy: EnemyState) {
  ensureEnemyMovement(mapIndex, enemy);
  const route = expandedPath(mapIndex);
  const targetIndex = Math.max(1, Math.min(route.length - 1, enemy.pathIndex ?? 1));
  const from = route[targetIndex - 1] ?? route[0] ?? { x: 0, y: 0 };
  const to = route[targetIndex] ?? from;
  const segmentLength = Math.max(0.0001, Math.hypot(to.x - from.x, to.y - from.y));
  const traveled = Math.max(0, Math.min(segmentLength,
    Math.hypot((enemy.pathX ?? from.x) - from.x, (enemy.pathY ?? from.y) - from.y)));
  enemy.progress = Math.max(0, Math.min(1, (targetIndex - 1 + traveled / segmentLength) / Math.max(1, route.length - 1)));
}

/** 敌军的权威逐节点坐标；旧快照仍可由 progress 无损迁移到折线路径。 */
export function enemyPathPoint(mapIndex: number, enemy: EnemyState) {
  ensureEnemyMovement(mapIndex, enemy);
  return { x: enemy.pathX ?? 0, y: enemy.pathY ?? 0 };
}

function normalWaveHp(snapshot: MatchSnapshot, player: PlayerBattleState) {
  const waveIndex = Math.max(0, player.wave - 1);
  const wave = WAVES[waveIndex] ?? WAVES[0];
  const curve = DIFFICULTY_CURVES[snapshot.difficultyCurve] ?? DIFFICULTY_CURVES[0];
  const introRound = Math.max(0, Math.floor(player.introRound ?? 10));
  const introMultiplier = player.wave <= 10 && introRound < INTRO_ROUND_HP_MULTIPLIERS.length
    ? INTRO_ROUND_HP_MULTIPLIERS[introRound] ?? 1 : 1;
  return wave[1] * (curve[waveIndex] ?? 1) * introMultiplier;
}

function spawnSummonedEnemy(
  snapshot: MatchSnapshot, player: PlayerBattleState, kind: NonNullable<EnemyState["summonedKind"]>,
  source?: EnemyState, unit?: UnitState,
) {
  const route = expandedPath(snapshot.mapIndex);
  const pathIndex = source?.pathIndex ?? Math.min(1, route.length - 1);
  const origin = source ? enemyPathPoint(snapshot.mapIndex, source) : route[0] ?? { x: 0, y: 0 };
  const hp = normalWaveHp(snapshot, player);
  const enemy: EnemyState = {
    id: `summon-${kind}-${player.slot}-${snapshot.tick}-${player.enemies.length}`,
    hp, maxHp: hp, progress: source?.progress ?? 0, boss: false, stunnedMs: 0,
    pathX: origin.x, pathY: origin.y, pathIndex, summonedKind: kind,
    ...(unit ? { summonedUnitKind: unit.kind, summonedUnitLevel: unit.level } : {}),
  };
  player.enemies.push(enemy);
  syncEnemyProgress(snapshot.mapIndex, enemy);
  return enemy;
}

function unitsInBossRange(snapshot: MatchSnapshot, player: PlayerBattleState, boss: EnemyState, range: number) {
  const center = enemyPathPoint(snapshot.mapIndex, boss);
  return player.units.filter((unit) => {
    const first = cellCoords(unit.cell);
    const second = unit.secondaryCell === undefined ? first : cellCoords(unit.secondaryCell);
    const point = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    return attackRangeIntersectsCell(center, point, range);
  });
}

function enemiesInBossRange(snapshot: MatchSnapshot, player: PlayerBattleState, boss: EnemyState, range: number) {
  const center = enemyPathPoint(snapshot.mapIndex, boss);
  return player.enemies.filter((enemy) => enemy.id !== boss.id
    && attackRangeIntersectsCell(center, enemyPathPoint(snapshot.mapIndex, enemy), range));
}

function finishBossSkill(snapshot: MatchSnapshot, player: PlayerBattleState, boss: EnemyState, targetIds: string[] = []) {
  if (boss.bossType === undefined) return;
  emitBattleEvent(snapshot, {
    type: "boss-skill", slot: player.slot, bossId: boss.id, bossType: boss.bossType,
    skillName: BOSS_CONFIGS[boss.bossType]?.name ?? "Boss技能", phase: "resolved", targetIds,
  });
  boss.bossSkillElapsedMs = undefined;
  boss.bossSkillTargetIds = undefined;
  boss.bossSkillHitIds = undefined;
  boss.resurrectionRemaining = undefined;
}

function beginBossSkill(snapshot: MatchSnapshot, player: PlayerBattleState, boss: EnemyState) {
  const bossType = boss.bossType;
  if (bossType === undefined) return;
  const config = BOSS_CONFIGS[bossType];
  if (!config) return;
  const rng = createRng(snapshot.seed ^ snapshot.tick ^ stringSeed(boss.id) ^ 0xB055);
  boss.bossCooldownMs = 0;
  if (hasPassive(player, 11) && rng.next() < 0.5) {
    const fraction = 0.1 + rng.next() * 0.1;
    damage(boss, boss.maxHp * fraction);
    emitBattleEvent(snapshot, {
      type: "boss-skill", slot: player.slot, bossId: boss.id, bossType,
      skillName: config.name, phase: "intercepted", targetIds: [boss.id],
    });
    return;
  }
  boss.bossSkillElapsedMs = 0;
  boss.bossSkillHitIds = [];
  emitBattleEvent(snapshot, {
    type: "boss-skill", slot: player.slot, bossId: boss.id, bossType,
    skillName: config.name, phase: "cast", targetIds: [],
  });

  if (bossType === 1) boss.resurrectionRemaining = 3;
  if (bossType === 4) {
    boss.bossSkillUsed = true;
    player.rainBossIds ??= [];
    if (!player.rainBossIds.includes(boss.id)) player.rainBossIds.push(boss.id);
  }
  if (bossType === 5) {
    const soldiers = player.units.filter((unit) => Boolean(SOLDIERS[unit.kind as SoldierKind]));
    const minimum = Math.min(...soldiers.map((unit) => unit.level));
    boss.bossSkillTargetIds = Number.isFinite(minimum) && minimum <= 3
      ? soldiers.filter((unit) => unit.level === minimum).map((unit) => unit.id) : [];
  }
  if (bossType === 7) boss.bossSkillTargetIds = unitsInBossRange(snapshot, player, boss, config.range).map((unit) => unit.id);
  if (bossType === 9) {
    const candidates = unitsInBossRange(snapshot, player, boss, config.range).filter((unit) => !unit.bossKnockedDown);
    boss.bossSkillTargetIds = candidates.length ? [candidates[Math.floor(rng.next() * candidates.length)]!.id] : [];
  }
}

function tickUnitBossStatuses(player: PlayerBattleState, deltaMs: number) {
  for (const unit of player.units) {
    if ((unit.bossChaosMs ?? 0) > 0) unit.bossChaosMs = Math.max(0, (unit.bossChaosMs ?? 0) - deltaMs);
    if ((unit.bossSuppressionMs ?? 0) > 0) {
      unit.bossSuppressionMs = Math.max(0, (unit.bossSuppressionMs ?? 0) - deltaMs);
      if (unit.bossSuppressionMs === 0 && unit.bossSuppressionOriginalLevel !== undefined) {
        unit.level = unit.bossSuppressionOriginalLevel;
        unit.bossSuppressionOriginalLevel = undefined;
      }
    }
    if ((unit.bossLockedMs ?? 0) > 0) unit.bossLockedMs = Math.max(0, (unit.bossLockedMs ?? 0) - deltaMs);
  }
  player.visionDarkMs = Math.max(0, (player.visionDarkMs ?? 0) - deltaMs);
}

function tickEnemyBuffs(enemy: EnemyState, deltaMs: number) {
  if ((enemy.battleInvulnerableMs ?? 0) > 0) {
    enemy.battleInvulnerableMs = Math.max(0, (enemy.battleInvulnerableMs ?? 0) - deltaMs);
  }
  if ((enemy.battleHasteMs ?? 0) > 0) {
    enemy.battleHasteMs = Math.max(0, (enemy.battleHasteMs ?? 0) - deltaMs);
  }
  if ((enemy.battleRallyMs ?? 0) > 0) {
    enemy.battleRallyMs = Math.max(0, (enemy.battleRallyMs ?? 0) - deltaMs);
    if (enemy.battleRallyMs === 0 && (enemy.battleRallyBonusHp ?? 0) > 0) {
      enemy.maxHp = Math.max(1, enemy.maxHp - (enemy.battleRallyBonusHp ?? 0));
      enemy.hp = Math.min(enemy.hp, enemy.maxHp);
      enemy.battleRallyBonusHp = 0;
    }
  }
  if ((enemy.generalSlowMs ?? 0) > 0) {
    enemy.generalSlowMs = Math.max(0, (enemy.generalSlowMs ?? 0) - deltaMs);
    if (enemy.generalSlowMs === 0) enemy.generalSlowMultiplier = 1;
  }
  if ((enemy.moveSpeedBuffMs ?? 0) > 0) {
    enemy.moveSpeedBuffMs = Math.max(0, (enemy.moveSpeedBuffMs ?? 0) - deltaMs);
    if (enemy.moveSpeedBuffMs === 0) {
      enemy.moveSpeedMultiplier = 1;
      enemy.scaleMultiplier = 1;
      if ((enemy.inspireBonusHp ?? 0) > 0) {
        enemy.maxHp = Math.max(1, enemy.maxHp - (enemy.inspireBonusHp ?? 0));
        enemy.hp = Math.min(enemy.hp, enemy.maxHp);
        enemy.inspireBonusHp = 0;
      }
    }
  }
}

function tickBossSkills(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  tickUnitBossStatuses(player, deltaMs);
  for (const enemy of player.enemies) tickEnemyBuffs(enemy, deltaMs);
  for (const boss of [...player.enemies]) {
    if (!boss.boss || boss.bossType === undefined || boss.hp <= 0) continue;
    const bossType = boss.bossType;
    const config = BOSS_CONFIGS[bossType];
    if (!config) continue;
    if (boss.bossSkillElapsedMs === undefined) {
      boss.bossCooldownMs = (boss.bossCooldownMs ?? 0) + deltaMs;
      if ((boss.bossCooldownMs ?? 0) >= config.cooldownMs && boss.stunnedMs <= 0 && !(bossType === 4 && boss.bossSkillUsed)) {
        beginBossSkill(snapshot, player, boss);
      }
      continue;
    }
    boss.bossSkillElapsedMs += deltaMs;
    const elapsed = boss.bossSkillElapsedMs;
    const rng = createRng(snapshot.seed ^ snapshot.tick ^ stringSeed(boss.id) ^ bossType);

    if (bossType === 0) {
      if (elapsed > 500 && elapsed < 1_400) {
        const radius = Math.min(config.range, (elapsed - 500) / 900 * config.range);
        const already = new Set(boss.bossSkillHitIds ?? []);
        for (const unit of unitsInBossRange(snapshot, player, boss, radius)) if (!already.has(unit.id)) {
          unit.bossChaosMs = Math.max(unit.bossChaosMs ?? 0, 2_000);
          already.add(unit.id);
        }
        boss.bossSkillHitIds = [...already];
      }
      if (elapsed >= 1_400) finishBossSkill(snapshot, player, boss, boss.bossSkillHitIds ?? []);
    } else if (bossType === 1) {
      if (elapsed >= 1_000) finishBossSkill(snapshot, player, boss);
    } else if (bossType === 2 && elapsed >= 500) {
      const targets = enemiesInBossRange(snapshot, player, boss, config.range);
      for (const target of targets) {
        const bonus = target.maxHp * 0.5;
        target.maxHp += bonus; target.hp += bonus; target.inspireBonusHp = (target.inspireBonusHp ?? 0) + bonus;
        target.moveSpeedMultiplier = 1.3; target.moveSpeedBuffMs = 5_000; target.scaleMultiplier = 1.2;
      }
      finishBossSkill(snapshot, player, boss, targets.map((target) => target.id));
    } else if (bossType === 3 && elapsed >= 500) {
      const occupied = new Set(player.units.flatMap(unitCells));
      const candidates = player.unlockedCells.filter((cell) => !occupied.has(cell));
      const chosen = candidates[Math.floor(rng.next() * candidates.length)];
      if (chosen !== undefined) player.unlockedCells = player.unlockedCells.filter((cell) => cell !== chosen);
      finishBossSkill(snapshot, player, boss, chosen === undefined ? [] : [`cell-${chosen}`]);
    } else if (bossType === 4) {
      finishBossSkill(snapshot, player, boss, player.units.map((unit) => unit.id));
    } else if (bossType === 5) {
      const targets = boss.bossSkillTargetIds ?? [];
      if (elapsed >= (targets.length ? 1_000 / targets.length : 0)) {
        const converted: string[] = [];
        for (const id of targets) {
          const unit = player.units.find((candidate) => candidate.id === id);
          if (!unit) continue;
          const path = expandedPath(snapshot.mapIndex);
          const bossIndex = boss.pathIndex ?? 1;
          const offset = Math.floor(rng.next() * 3) - 1;
          const pathIndex = Math.max(1, Math.min(path.length - 1, bossIndex + offset));
          const source: EnemyState = { ...boss, boss: false, pathIndex, pathX: path[pathIndex]?.x, pathY: path[pathIndex]?.y };
          player.units = player.units.filter((candidate) => candidate.id !== id);
          converted.push(spawnSummonedEnemy(snapshot, player, "puppet", source, unit).id);
        }
        finishBossSkill(snapshot, player, boss, converted);
      }
    } else if (bossType === 6) {
      const summoned = spawnSummonedEnemy(snapshot, player, "cavalry");
      finishBossSkill(snapshot, player, boss, [summoned.id]);
    } else if (bossType === 7 && elapsed >= 650) {
      const affected: string[] = [];
      for (const id of boss.bossSkillTargetIds ?? []) {
        const unit = player.units.find((candidate) => candidate.id === id);
        if (!unit) continue;
        if (unit.bossSuppressionOriginalLevel === undefined) unit.bossSuppressionOriginalLevel = unit.level;
        unit.level = 1; unit.bossSuppressionMs = 5_000; affected.push(id);
      }
      finishBossSkill(snapshot, player, boss, affected);
    } else if (bossType === 8 && elapsed >= 500) {
      const targets = enemiesInBossRange(snapshot, player, boss, config.range);
      player.enemies = player.enemies.filter((enemy) => !targets.includes(enemy));
      if (targets.length) {
        const gain = normalWaveHp(snapshot, player) * 2 * targets.length;
        boss.hp += gain; boss.maxHp += gain; boss.scaleMultiplier = (boss.scaleMultiplier ?? 1) + 0.01 * targets.length;
      }
      finishBossSkill(snapshot, player, boss, targets.map((target) => target.id));
    } else if (bossType === 9) {
      const unit = player.units.find((candidate) => candidate.id === boss.bossSkillTargetIds?.[0]);
      const bossPoint = enemyPathPoint(snapshot.mapIndex, boss);
      const point = unit ? cellCoords(unit.cell) : bossPoint;
      const duration = unit ? Math.max(1, Math.hypot(point.x - bossPoint.x, point.y - bossPoint.y) * ORIGINAL_CELL_PX * 3) : 0;
      if (elapsed >= duration) {
        if (unit) unit.bossKnockedDown = true;
        finishBossSkill(snapshot, player, boss, unit ? [unit.id] : []);
      }
    } else if (bossType === 10 && elapsed >= 1_000) {
      player.visionDarkMs = 5_000;
      finishBossSkill(snapshot, player, boss);
    } else if (bossType === 11 && elapsed >= 1_000) {
      const soldiers = player.units.filter((unit) => Boolean(SOLDIERS[unit.kind as SoldierKind]) && (unit.bossLockedMs ?? 0) === 0);
      const maximum = Math.max(...soldiers.map((unit) => unit.level));
      const target = soldiers.find((unit) => unit.level === maximum);
      if (target) target.bossLockedMs = target.level < 5 ? -1 : 10_000;
      finishBossSkill(snapshot, player, boss, target ? [target.id] : []);
    }
  }
}

function scheduleHuangZhongArrowRain(snapshot: MatchSnapshot, player: PlayerBattleState, unit: UnitState, attackValue: number) {
  const route = expandedPath(snapshot.mapIndex).slice(1);
  const rng = createRng(snapshot.seed ^ snapshot.tick ^ stringSeed(unit.id) ^ 0xA220);
  const multiplier = Math.floor(Math.max(1, (unit.level - 1) / 2));
  const points: Array<{ x: number; y: number }> = [];
  for (const cell of route) {
    const count = (1 + Math.floor(rng.next() * 2)) * multiplier;
    for (let index = 0; index < count; index += 1) {
      points.push({
        x: cell.x + 0.5 + (Math.floor(rng.next() * 48) - 24) / ORIGINAL_CELL_PX,
        y: cell.y + 0.5 + (Math.floor(rng.next() * 48) - 24) / ORIGINAL_CELL_PX,
      });
    }
  }
  for (let index = points.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng.next() * (index + 1));
    [points[index], points[swap]] = [points[swap]!, points[index]!];
  }
  let cumulativeDelay = 0;
  player.pendingArrowImpacts ??= [];
  for (const [index, point] of points.entries()) {
    cumulativeDelay += 500 + Math.floor(rng.next() * 250);
    player.pendingArrowImpacts.push({
      id: `arrow-rain-${unit.id}-${snapshot.tick}-${index}`, unitId: unit.id,
      x: point.x, y: point.y, damage: attackValue * 2, remainingMs: cumulativeDelay,
    });
  }
  unit.generalSkillLockMs = cumulativeDelay;
}

function tickArrowRain(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  const pending = player.pendingArrowImpacts ?? [];
  const remaining = [] as typeof pending;
  for (const impact of pending) {
    impact.remainingMs -= deltaMs;
    if (impact.remainingMs > 0) { remaining.push(impact); continue; }
    const targets = player.enemies.filter((enemy) => enemy.hp > 0 && !enemyHiddenBySmoke(snapshot, player, enemy)
      && Math.hypot(enemyPathPoint(snapshot.mapIndex, enemy).x + 0.5 - impact.x,
        enemyPathPoint(snapshot.mapIndex, enemy).y + 0.5 - impact.y) <= 150 / ORIGINAL_CELL_PX);
    const aliveBeforeImpact = new Set(targets.map((target) => target.id));
    for (const target of targets) damage(target, impact.damage);
    const general = player.units.find((unit) => unit.id === impact.unitId);
    if (general) grantGeneralExperienceForNewDefeats(snapshot, player, general, aliveBeforeImpact);
    emitBattleEvent(snapshot, {
      type: "arrow-rain-impact", slot: player.slot, unitId: impact.unitId,
      x: impact.x, y: impact.y, damage: impact.damage, targetIds: targets.map((target) => target.id),
    });
  }
  player.pendingArrowImpacts = remaining;
}

export function bulldozerSupplyAvailable(snapshot: MatchSnapshot, player: PlayerBattleState) {
  const props = ensureProps(player);
  if (props.bulldozer || props.bulldozerSupplyClaimed) return false;
  const route = expandedPath(snapshot.mapIndex);
  return player.enemies.some((enemy) => route.length - (enemy.pathIndex ?? 1) <= 5);
}

function claimBulldozerSupply(snapshot: MatchSnapshot, player: PlayerBattleState): string | null {
  if (!bulldozerSupplyAvailable(snapshot, player)) return "敌军接近终点时才可领取推土车补给";
  const route = expandedPath(snapshot.mapIndex);
  const startIndex = Math.max(0, route.length - 2);
  const routeIndices: number[] = [];
  for (let index = startIndex; index >= 0; index -= 1) {
    routeIndices.push(index);
    if (routeIndices.length > 11) break;
  }
  const start = route[startIndex] ?? { x: 0, y: 0 };
  const props = ensureProps(player);
  props.bulldozerSupplyClaimed = true;
  props.bulldozer = { x: start.x, y: start.y, routeIndices, cursor: 0, phase: "moving", fadeMs: 5_000 };
  emitBattleEvent(snapshot, { type: "bulldozer", slot: player.slot, phase: "launched", targetIds: [] });
  player.lastEvent = "推土车出动（原广告补给已直接领取）";
  return null;
}

function pushEnemyWithBulldozer(snapshot: MatchSnapshot, enemy: EnemyState, offsetX: number, offsetY: number) {
  ensureEnemyMovement(snapshot.mapIndex, enemy);
  const route = expandedPath(snapshot.mapIndex);
  const currentIndex = enemy.pathIndex ?? 1;
  if (currentIndex < 2) return false;
  const destinationIndex = currentIndex - 1;
  const previous = route[destinationIndex] ?? route[0]!;
  const current = route[currentIndex] ?? previous;
  let x = previous.x; let y = previous.y;
  const clamp = 39 / ORIGINAL_CELL_PX;
  if (current.y !== previous.y) y += Math.min(Math.max(0, offsetY), clamp);
  else if (current.x !== previous.x) x += Math.min(Math.max(0, offsetX), clamp);
  else return false;
  if (Math.abs((enemy.pathX ?? 0) - x) < 2 / ORIGINAL_CELL_PX && Math.abs((enemy.pathY ?? 0) - y) < 2 / ORIGINAL_CELL_PX) return false;
  enemy.pathX = x; enemy.pathY = y; enemy.pathIndex = destinationIndex;
  syncEnemyProgress(snapshot.mapIndex, enemy);
  return true;
}

function tickBulldozer(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  const props = ensureProps(player);
  const bulldozer = props.bulldozer;
  if (!bulldozer) return;
  const route = expandedPath(snapshot.mapIndex);
  if (bulldozer.phase === "moving") {
    const target = route[bulldozer.routeIndices[bulldozer.cursor] ?? 0] ?? { x: bulldozer.x, y: bulldozer.y };
    const dx = target.x - bulldozer.x; const dy = target.y - bulldozer.y;
    if (Math.abs(dx) <= 5 / ORIGINAL_CELL_PX && Math.abs(dy) <= 5 / ORIGINAL_CELL_PX) {
      bulldozer.cursor += 1;
      if (bulldozer.cursor >= bulldozer.routeIndices.length - 1) bulldozer.phase = "fading";
    } else {
      const distance = Math.hypot(dx, dy);
      const step = 50 * deltaMs / 1_000 / ORIGINAL_CELL_PX;
      bulldozer.x += step * dx / distance; bulldozer.y += step * dy / distance;
    }
  } else {
    bulldozer.fadeMs -= deltaMs;
  }
  const offsetX = bulldozer.x - Math.floor(bulldozer.x);
  const offsetY = bulldozer.y - Math.floor(bulldozer.y);
  const pushed = player.enemies.filter((enemy) => Math.hypot(
    enemyPathPoint(snapshot.mapIndex, enemy).x - bulldozer.x,
    enemyPathPoint(snapshot.mapIndex, enemy).y - bulldozer.y,
  ) < 0.5 && pushEnemyWithBulldozer(snapshot, enemy, offsetX, offsetY));
  if (pushed.length) emitBattleEvent(snapshot, { type: "bulldozer", slot: player.slot, phase: "push", targetIds: pushed.map((enemy) => enemy.id) });
  if (bulldozer.phase === "fading" && bulldozer.fadeMs <= 0) {
    props.bulldozer = undefined;
    emitBattleEvent(snapshot, { type: "bulldozer", slot: player.slot, phase: "expired", targetIds: [] });
  }
}

function advanceEnemyAlongOriginalPath(snapshot: MatchSnapshot, player: PlayerBattleState, enemy: EnemyState, deltaMs: number) {
  ensureEnemyMovement(snapshot.mapIndex, enemy);
  const route = expandedPath(snapshot.mapIndex);
  const target = route[enemy.pathIndex ?? 1];
  if (!target) { enemy.progress = 1; return; }
  const dx = target.x - (enemy.pathX ?? target.x); const dy = target.y - (enemy.pathY ?? target.y);
  const distancePx = Math.hypot(dx, dy) * ORIGINAL_CELL_PX;
  // 原包 _s.move：进入 1px 阈值的这一帧只切换目标节点，不发生位移。
  if (distancePx < 1) {
    enemy.pathIndex = (enemy.pathIndex ?? 1) + 1;
    if ((enemy.pathIndex ?? 0) >= route.length) enemy.progress = 1;
    else syncEnemyProgress(snapshot.mapIndex, enemy);
    return;
  }
  const silt = hasPassive(player, 18) ? 0.9 : 1;
  const bossSpeed = enemy.bossType === undefined
    ? BOSS_ENEMY_SPEED_PX_PER_SEC : BOSS_CONFIGS[enemy.bossType]?.speedPxPerSec ?? BOSS_ENEMY_SPEED_PX_PER_SEC;
  const battleBuffSpeed = ((enemy.battleHasteMs ?? 0) > 0 ? 2 : 1) * ((enemy.battleRallyMs ?? 0) > 0 ? 1.2 : 1);
  const speed = (enemy.boss ? bossSpeed : NORMAL_ENEMY_SPEED_PX_PER_SEC) * silt
    * (enemy.moveSpeedMultiplier ?? 1) * (enemy.generalSlowMultiplier ?? 1) * battleBuffSpeed;
  const stepCells = speed * deltaMs / 1_000 / ORIGINAL_CELL_PX;
  enemy.pathX = (enemy.pathX ?? target.x) + dx / (distancePx / ORIGINAL_CELL_PX) * stepCells;
  enemy.pathY = (enemy.pathY ?? target.y) + dy / (distancePx / ORIGINAL_CELL_PX) * stepCells;
  syncEnemyProgress(snapshot.mapIndex, enemy);
}

function tickProps(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  const props = ensureProps(player);
  for (const id of props.loadout.active) props.cooldowns[id] = Math.max(0, (props.cooldowns[id] ?? 0) - deltaMs);
  for (const unit of player.units) {
    if ((unit.generalSkillLockMs ?? 0) > 0) unit.generalSkillLockMs = Math.max(0, (unit.generalSkillLockMs ?? 0) - deltaMs);
    if ((unit.temporaryAttackSpeedMs ?? 0) > 0) {
      unit.temporaryAttackSpeedMs = Math.max(0, (unit.temporaryAttackSpeedMs ?? 0) - deltaMs);
      if (unit.temporaryAttackSpeedMs === 0) unit.temporaryAttackSpeedMultiplier = 1;
    }
    if (unit.kind === "农") {
      const interval = [20_000, 10_000, 5_000, 3_000, 2_000][Math.max(0, Math.min(4, unit.level - 1))] ?? 20_000;
      unit.incomeMs = (unit.incomeMs ?? interval) - deltaMs;
      while (unit.incomeMs <= 0) { player.buns += 1; unit.incomeMs += interval; }
    }
  }
  for (const item of player.reserve) if (item.kind === "农") {
    const interval = [20_000, 10_000, 5_000, 3_000, 2_000][Math.max(0, Math.min(4, item.level - 1))] ?? 20_000;
    item.incomeMs = (item.incomeMs ?? interval) - deltaMs;
    while (item.incomeMs <= 0) { player.buns += 1; item.incomeMs += interval; }
  }

  if (hasPassive(player, 12)) {
    props.farmerSpawnMs -= deltaMs;
    if (props.farmerSpawnMs <= 0) {
      props.farmerSpawnMs += 30_000;
      const cell = player.unlockedCells.find((candidate) => !unitAtCell(player, candidate));
      if (cell !== undefined) {
        const unit = { id: `farmer-${player.slot}-${snapshot.tick}`, kind: "农", level: 1, cell, cooldownMs: 0, attackCount: 0, incomeMs: 20_000 };
        player.units.push(unit);
        emitBattleEvent(snapshot, { type: "unit-deployed", slot: player.slot, unitId: unit.id, unitKind: unit.kind, cells: [unit.cell] });
      }
      else {
        const slot = firstEmptyReserveSlot(player);
        if (slot !== null) {
          const item = { id: `farmer-r-${player.slot}-${snapshot.tick}`, kind: "农", level: 1, slot, incomeMs: 20_000 };
          player.reserve.push(item);
          emitBattleEvent(snapshot, { type: "reserve-granted", slot: player.slot, reserveIds: [item.id], reason: "farmer" });
        }
      }
    }
  }
  if (hasPassive(player, 19)) {
    props.superShovelMs -= deltaMs;
    if (props.superShovelMs <= 0) {
      props.superShovelMs += 60_000;
      const slot = firstEmptyReserveSlot(player);
      if (slot !== null) {
        const item = { id: `super-shovel-${player.slot}-${snapshot.tick}`, kind: "铲子", level: 1, slot };
        player.reserve.push(item);
        emitBattleEvent(snapshot, { type: "reserve-granted", slot: player.slot, reserveIds: [item.id], reason: "super-shovel" });
      }
    }
  }
  if (hasPassive(player, 20)) {
    props.meteorMs = Math.max(0, props.meteorMs - deltaMs);
    const endCells = expandedPath(snapshot.mapIndex).slice(-6);
    const threatened = player.enemies.some((enemy) => {
      const point = enemyPathPoint(snapshot.mapIndex, enemy);
      return endCells.some((cell) => Math.hypot(point.x - cell.x, point.y - cell.y) <= 1);
    });
    if (threatened && props.meteorMs === 0) {
      const defeated = player.enemies.filter((enemy) => {
        if ((enemy.battleInvulnerableMs ?? 0) > 0) return false;
        const point = enemyPathPoint(snapshot.mapIndex, enemy);
        return endCells.some((cell) => Math.hypot(point.x - cell.x, point.y - cell.y) <= 1);
      });
      const defeatedIds = defeated.map((enemy) => enemy.id);
      player.enemies = player.enemies.filter((enemy) => {
        if ((enemy.battleInvulnerableMs ?? 0) > 0) return true;
        const point = enemyPathPoint(snapshot.mapIndex, enemy);
        return !endCells.some((cell) => Math.hypot(point.x - cell.x, point.y - cell.y) <= 1);
      });
      for (const enemy of defeated) maybeDropBattleBuff(snapshot, player, enemy);
      props.meteorMs = 300_000;
      player.lastEvent = "陨石落下，清除阿斗附近敌军";
      emitBattleEvent(snapshot, { type: "prop-triggered", slot: player.slot, propId: 20, targetIds: defeatedIds });
    }
  }

  for (const placed of [...props.placed]) {
    const cell = cellCoords(placed.cell);
    const trigger = player.enemies.find((enemy) => {
      const point = enemyPathPoint(snapshot.mapIndex, enemy);
      return Math.hypot(point.x - cell.x, point.y - cell.y) <= 0.25;
    });
    if (!trigger) continue;
    let targetIds: string[];
    if (placed.propId === 8) {
      trigger.stunnedMs = Math.max(trigger.stunnedMs, 5_000);
      targetIds = [trigger.id];
    }
    else {
      const defeated = player.enemies.filter((enemy) => {
        if ((enemy.battleInvulnerableMs ?? 0) > 0) return false;
        const point = enemyPathPoint(snapshot.mapIndex, enemy);
        return Math.hypot(point.x - cell.x, point.y - cell.y) <= 0.75;
      });
      targetIds = defeated.map((enemy) => enemy.id);
      player.enemies = player.enemies.filter((enemy) => {
        if ((enemy.battleInvulnerableMs ?? 0) > 0) return true;
        const point = enemyPathPoint(snapshot.mapIndex, enemy);
        return Math.hypot(point.x - cell.x, point.y - cell.y) > 0.75;
      });
      for (const enemy of defeated) maybeDropBattleBuff(snapshot, player, enemy);
    }
    props.placed = props.placed.filter((candidate) => candidate.id !== placed.id);
    player.lastEvent = placed.propId === 8 ? "陷阱触发：敌人眩晕5秒" : "地雷触发：范围敌军被消灭";
    emitBattleEvent(snapshot, { type: "prop-triggered", slot: player.slot, propId: placed.propId, targetIds });
  }
}

function tickBattleFieldEffects(player: PlayerBattleState, deltaMs: number) {
  const remaining: BattleFieldEffectState[] = [];
  for (const effect of player.battleFieldEffects ?? []) {
    if (effect.kind === "smoke") {
      effect.remainingMs = Math.max(0, effect.remainingMs - deltaMs);
      if (effect.remainingMs > 0) remaining.push(effect);
    } else if (effect.remainingHits > 0) remaining.push(effect);
  }
  player.battleFieldEffects = remaining;
}

function advanceWave(player: PlayerBattleState) {
  if (player.wave >= GAME_CONFIG.maxWaves) {
    player.phase = "finished";
    player.lastEvent = "守住全部20波";
    return;
  }
  player.wave += 1;
  const nextWave = WAVES[player.wave - 1] ?? WAVES[0];
  player.remainingToSpawn = nextWave[0];
  player.spawnMs = GAME_CONFIG.spawnMs;
  player.interwaveMs = 0;
  player.lastEvent = `第${player.wave}波来袭`;
}

function tickPlayer(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  if (player.phase === "preparing") {
    player.prepareMs -= deltaMs;
    if (player.prepareMs <= 0) { player.phase = "battle"; player.lastEvent = "第1波来袭"; }
    return;
  }
  if (player.phase !== "battle") return;
  tickProps(snapshot, player, deltaMs);
  tickBattleFieldEffects(player, deltaMs);
  player.spawnMs -= deltaMs;
  if (player.remainingToSpawn > 0 && player.spawnMs <= 0) {
    spawnEnemy(snapshot, player);
    player.spawnMs += GAME_CONFIG.spawnMs;
  }
  tickBossSkills(snapshot, player, deltaMs);
  tickArrowRain(snapshot, player, deltaMs);
  tickGeneralImpacts(snapshot, player, deltaMs);
  tickZhaoPhantoms(snapshot, player, deltaMs);
  attack(snapshot, player, deltaMs);
  tickBulldozer(snapshot, player, deltaMs);
  for (const enemy of player.enemies) {
    enemy.stunnedMs = Math.max(0, enemy.stunnedMs - deltaMs);
    if (enemy.stunnedMs === 0 && enemy.bossSkillElapsedMs === undefined) {
      advanceEnemyAlongOriginalPath(snapshot, player, enemy, deltaMs);
    }
  }
  const escaped = player.enemies.filter((enemy) => enemy.progress >= 1);
  if (escaped.length) {
    player.enemies = player.enemies.filter((enemy) => enemy.progress < 1);
    player.hp = Math.max(0, player.hp - escaped.length);
    const awardedBuns = escaped.length * GAME_CONFIG.hpLostBuns;
    player.buns += awardedBuns;
    player.lastEvent = `阿斗受击 ×${escaped.length}，+${awardedBuns}馒头`;
    emitBattleEvent(snapshot, {
      type: "player-damaged", slot: player.slot, escapedCount: escaped.length,
      remainingHp: player.hp, awardedBuns,
    });
  }
  if (player.remainingToSpawn === 0 && player.enemies.length === 0) {
    player.interwaveMs += deltaMs;
    if (player.interwaveMs >= GAME_CONFIG.interwaveMs) advanceWave(player);
  }
}

export function stepMatch(snapshot: MatchSnapshot, deltaMs: number) {
  normalizeMatchSnapshot(snapshot);
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) throw new RangeError("deltaMs 必须是大于 0 的有限毫秒值");
  if (snapshot.phase === "finished" || snapshot.phase === "waiting") return snapshot;
  beginTransition(snapshot);
  snapshot.tick += 1;
  snapshot.simulationTimeMs += deltaMs;
  snapshot.serverTime = snapshot.simulationTimeMs;
  snapshot.players.forEach((player) => tickPlayer(snapshot, player, deltaMs));
  if (snapshot.players.some((player) => player.phase === "battle")) snapshot.phase = "battle";
  const dead = snapshot.players.map((player) => player.hp <= 0);
  const survived = snapshot.players.map((player) => player.phase === "finished" && player.hp > 0);
  if (dead[0] || dead[1] || survived[0] || survived[1]) {
    snapshot.phase = "finished";
    if ((dead[0] && dead[1]) || (survived[0] && survived[1])) snapshot.winner = "draw";
    else snapshot.winner = (dead[0] || survived[1]) ? 1 : 0;
    snapshot.players.forEach((player) => { player.phase = "finished"; });
    emitBattleEvent(snapshot, { type: "match-finished", winner: snapshot.winner });
  }
  snapshot.stateVersion += 1;
  return snapshot;
}

export function cloneSnapshot(snapshot: MatchSnapshot): MatchSnapshot {
  const clone = structuredClone(snapshot);
  normalizeMatchSnapshot(clone);
  return clone;
}
