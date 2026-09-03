import {
  ACTIVE_PROP_IDS, BOSS_CHANCES, BOSS_MILESTONES, DIFFICULTY_CURVES, DIFFICULTY_WEIGHTS,
  EARLY_ACCOUNT_SHOVEL_BONUS, GAME_CONFIG, GENERALS, HERO_PAIRS, LEVEL_ATTACK, LEVEL_SPEED,
  MAP_LAYOUTS, PASSIVE_PROP_IDS, PROPS, SOLDIERS, TOKEN_POOL, WAVES, cellCode, cellCoords, initialOpenCells, pathPoint,
} from "./config";
import type {
  BattleEvent, BattleEventPayload, CommandEnvelope, CommandErrorCode, CommandFailure, CommandResult, GameCommand,
  MatchSnapshot, PlayerBattleState, PlayerPropState, PlayerSlot, PropLoadout, ReserveItem, UnitState,
} from "./types";
import type { ActivePropId, PassivePropId, SoldierKind } from "./config";

export interface Rng { next(): number; }

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

function hydrateSnapshot(snapshot: MatchSnapshot) {
  const incomingVersion = (snapshot as unknown as { snapshotVersion?: number }).snapshotVersion;
  if (incomingVersion !== undefined && incomingVersion !== 1) {
    throw new RangeError(`不支持的快照版本：${incomingVersion}`);
  }
  snapshot.snapshotVersion ??= 1;
  snapshot.events ??= [];
  snapshot.eventSequence ??= 0;
  snapshot.combatEvents ??= [];
  snapshot.acceptedCommands ??= {};
  snapshot.lastClientSeq ??= [0, 0];
  snapshot.simulationTimeMs ??= Number.isFinite(snapshot.serverTime) ? snapshot.serverTime : 0;
  snapshot.serverTime = snapshot.simulationTimeMs;
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

function emptyPropState(): PlayerPropState {
  return {
    configured: false, loadout: { active: [], passive: [] }, cooldowns: {}, placed: [],
    farmerSpawnMs: 30_000, superShovelMs: 60_000, meteorMs: 300_000,
  };
}

function ensureProps(player: PlayerBattleState) {
  player.props ??= emptyPropState();
  player.props.cooldowns ??= {};
  player.props.placed ??= [];
  player.props.shovelSupplyClaimed ??= false;
  return player.props;
}

function passiveLevel(player: PlayerBattleState | undefined, id: PassivePropId) {
  if (!player) return 0;
  return ensureProps(player).loadout.passive.find((entry) => entry.id === id)?.level ?? 0;
}

function hasPassive(player: PlayerBattleState | undefined, id: PassivePropId) {
  return passiveLevel(player, id) > 0;
}

function createPlayer(slot: PlayerSlot, mapIndex: number): PlayerBattleState {
  const firstWave = WAVES[0];
  return {
    slot, hp: GAME_CONFIG.baseHp, maxHp: GAME_CONFIG.baseHp,
    buns: GAME_CONFIG.startBuns, recruitCost: GAME_CONFIG.recruitBase, recruitCount: 0,
    wave: 1, phase: "preparing", prepareMs: GAME_CONFIG.prepareMs,
    interwaveMs: 0, spawnMs: GAME_CONFIG.spawnMs, remainingToSpawn: firstWave[0],
    units: [], reserve: [], unlockedCells: initialOpenCells(mapIndex), enemies: [], props: emptyPropState(), lastEvent: "等待双方布阵",
  };
}

export function createMatch(roomId: string, seed: number, mapIndex = 0): MatchSnapshot {
  const normalizedSeed = Number.isFinite(seed) ? seed >>> 0 : 0;
  const normalizedMap = Number.isFinite(mapIndex) ? Math.max(0, Math.min(MAP_LAYOUTS.length - 1, Math.floor(mapIndex))) : 0;
  const planningRng = createRng(normalizedSeed);
  const difficultyCurve = weightedIndex(planningRng, DIFFICULTY_WEIGHTS);
  const bossWaves = BOSS_MILESTONES.filter((_, index) => planningRng.next() < (BOSS_CHANCES[index] ?? 0));
  return {
    snapshotVersion: 1, roomId, tick: 0, stateVersion: 0, simulationTimeMs: 0,
    seed: normalizedSeed, mapIndex: normalizedMap, phase: "preparing", difficultyCurve, bossWaves,
    players: [createPlayer(0, normalizedMap), createPlayer(1, normalizedMap)],
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
  const universalSpeed = (hasPassive(player, 14) ? 0.1 : 0)
    + (opponent && hasPassive(opponent, 14) ? 0.1 : 0);
  const togetherSpeed = (hasPassive(player, 15) ? 0.5 : 0) + (hasPassive(opponent, 15) ? 0.3 : 0);
  const speedMultiplier = Math.max(0.05,
    1 + universalSpeed + togetherSpeed + ((unit.attackSpeedMultiplier ?? 1) - 1)
      + ((unit.temporaryAttackSpeedMultiplier ?? 1) - 1));
  return {
    attack: base.attack * (LEVEL_ATTACK[levelIndex] ?? 1),
    intervalMs: base.intervalMs / (LEVEL_SPEED[levelIndex] ?? 1) / speedMultiplier,
    range: base.range * (unit.rangeMultiplier ?? 1),
    maxLevel: base.maxLevel,
  };
}

function recycleValue(items: readonly ReserveItem[]) {
  return items.reduce((sum, item) => sum + (item.kind === "铲子" ? 1 : 2 ** Math.max(0, item.level - 1)), 0);
}

function recruit(snapshot: MatchSnapshot, player: PlayerBattleState, rng: Rng): string | null {
  const recycled = recycleValue(player.reserve);
  const spent = player.recruitCost;
  if (player.buns + recycled < spent) return "馒头不足";
  player.buns += recycled - spent;
  player.recruitCount += 1;
  player.recruitCost = GAME_CONFIG.recruitBase + player.recruitCount * GAME_CONFIG.recruitStep;
  const pool = TOKEN_POOL.map(([kind, weight]) => [kind,
    kind === "铲子" && ensureProps(player).earlyAccountShovelBonus ? weight + EARLY_ACCOUNT_SHOVEL_BONUS : weight,
  ] as [typeof kind, number]);
  if (hasPassive(player, 13)) {
    const excluded = new Set(["刀", "弓", "枪", "骑", "铲子", "农"]);
    for (const entry of pool) if (!excluded.has(entry[0]) && rng.next() < 0.5) entry[1] *= 2;
  }
  const promotionChance = [0.05, 0.1, 0.15][Math.max(0, Math.min(2, passiveLevel(player, 22) - 1))] ?? 0;
  player.reserve = Array.from({ length: GAME_CONFIG.reserveSize }, (_, slot) => {
    const kindIndex = weightedIndex(rng, pool.map((entry) => entry[1]));
    const kind = pool[kindIndex]?.[0] ?? "刀";
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
  return GENERALS[kind]?.maxLevel ?? SOLDIERS[kind as keyof typeof SOLDIERS]?.maxLevel ?? null;
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
    ...(unit.incomeMs === undefined ? {} : { incomeMs: unit.incomeMs }),
    ...(secondarySlot === undefined ? {} : {
      secondarySlot,
      parts: unit.parts ?? [unit.kind[0] ?? "", unit.kind[1] ?? ""] as [string, string],
    }),
  };
}

/** 战场姓名字横向相邻即合将；返回生成武将的单位 ID。 */
function autoCombineHorizontalGeneral(snapshot: MatchSnapshot, player: PlayerBattleState, unitId: string) {
  const source = player.units.find((unit) => unit.id === unitId);
  if (!source || source.secondaryCell !== undefined) return null;
  const sourcePoint = cellCoords(source.cell);
  const neighborCells = [sourcePoint.x - 1, sourcePoint.x + 1]
    .filter((x) => x >= 0 && x < GAME_CONFIG.columns)
    .map((x) => sourcePoint.y * GAME_CONFIG.columns + x)
    .sort((a, b) => a - b);

  for (const neighborCell of neighborCells) {
    const neighbor = unitAtCell(player, neighborCell);
    if (!neighbor || neighbor.id === source.id || neighbor.secondaryCell !== undefined) continue;
    const hero = HERO_PAIRS[`${source.kind}+${neighbor.kind}`];
    if (!hero) continue;

    const [survivor, consumed] = source.cell < neighbor.cell ? [source, neighbor] : [neighbor, source];
    survivor.kind = hero;
    survivor.level = Math.max(source.level, neighbor.level);
    survivor.cell = Math.min(source.cell, neighbor.cell);
    survivor.secondaryCell = Math.max(source.cell, neighbor.cell);
    survivor.parts = [hero[0] ?? source.kind, hero[1] ?? neighbor.kind];
    survivor.cooldownMs = 0;
    survivor.attackCount = 0;
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

function combine(player: PlayerBattleState, source: { kind: string; level: number }, target: UnitState, sourceUnit?: UnitState): string | null {
  const hero = HERO_PAIRS[`${source.kind}+${target.kind}`];
  if (hero) {
    const companionCell = adjacentCellForGeneral(player, target, sourceUnit);
    if (companionCell === null) return "武将需要占用横向相邻两格，请先腾出空位";
    const cells = [target.cell, companionCell].sort((a, b) => a - b);
    const parts = [...hero];
    target.kind = hero;
    target.level = Math.max(source.level, target.level);
    target.cell = cells[0]!;
    target.secondaryCell = cells[1]!;
    target.parts = [parts[0] ?? source.kind, parts[1] ?? target.kind];
    target.cooldownMs = 0; target.attackCount = 0;
    return null;
  }
  if (source.kind !== target.kind || source.level !== target.level) return "文字或等级不符合合成关系";
  const maxLevel = unitStats(target)?.maxLevel;
  if (!maxLevel) return "文字单位不能同字升级";
  if (target.level >= maxLevel) return "单位已满级";
  target.level += 1; target.cooldownMs = 0; target.attackCount = 0;
  return null;
}

function combineReserve(player: PlayerBattleState, source: { kind: string; level: number }, target: ReserveItem, sourceItem?: ReserveItem): string | null {
  const hero = HERO_PAIRS[`${source.kind}+${target.kind}`];
  if (hero) {
    const companionSlot = adjacentReserveSlot(player, target.slot, sourceItem);
    if (companionSlot === null) return "两字武将需要占用营地相邻两格";
    const slots = [target.slot, companionSlot].sort((a, b) => a - b);
    target.kind = hero;
    target.level = Math.max(source.level, target.level);
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
  return null;
}

function dropReserve(snapshot: MatchSnapshot, player: PlayerBattleState, reserveId: string, targetCell: number): string | null {
  const item = player.reserve.find((candidate) => candidate.id === reserveId);
  if (!item) return "营地棋子不存在";
  if (item.kind === "铲子") {
    if (cellCode(snapshot.mapIndex, targetCell) !== "2_0") return "铲子只能开垦己方草格";
    if (player.unlockedCells.includes(targetCell)) return "该格已经开放";
    if (!isAdjacentToUnlocked(player, targetCell)) return "只能开垦与已开放区域相邻的草格";
    player.unlockedCells.push(targetCell);
    player.reserve = player.reserve.filter((candidate) => candidate.id !== reserveId);
    player.lastEvent = "铲子开垦一格";
    emitBattleEvent(snapshot, { type: "cell-unlocked", slot: player.slot, cell: targetCell, sourceReserveId: reserveId });
    return null;
  }
  if (!canBuild(player, targetCell)) return "只能放入己方已开放白格";
  const target = unitAtCell(player, targetCell);
  if (target) {
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
  if (source.secondaryCell !== undefined) return "两格武将请先拆字再放回营地";
  const target = reserveAtSlot(player, targetSlot);
  if (target) {
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
  if (unitAtCell(player, targetCell)) return "拆字目标格必须为空";
  const parts = general.parts ?? [general.kind[0] ?? "", general.kind[1] ?? ""];
  const otherIndex: 0 | 1 = partIndex === 0 ? 1 : 0;
  const idBase = `${general.id}-split-${snapshot.stateVersion + 1}`;
  const makePart = (index: 0 | 1, cell: number): UnitState => ({
    id: `${idBase}-${index}`, kind: parts[index], level: general.level, cell,
    cooldownMs: 0, attackCount: 0,
  });
  const stationaryPart = makePart(otherIndex, cells[otherIndex]);
  const movedPart = makePart(partIndex, targetCell);
  player.units = player.units.filter((unit) => unit.id !== general.id);
  const partsAfterSplit = [stationaryPart, movedPart];
  player.units.push(...partsAfterSplit);
  player.lastEvent = `拆分「${general.kind}」为「${parts[0]}」「${parts[1]}」`;
  emitBattleEvent(snapshot, {
    type: "general-split", slot: player.slot, generalId: general.id,
    parts: partsAfterSplit.map((part) => ({ id: part.id, kind: part.kind, cell: part.cell })),
  });
  autoCombineHorizontalGeneral(snapshot, player, movedPart.id);
  autoCombineHorizontalGeneral(snapshot, player, stationaryPart.id);
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
  props.loadout = normalized;
  for (const id of normalized.active) props.cooldowns[id] = 0;
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
    player.lastEvent = `${config.name}：${ownUnit.kind}升降至Lv.${ownUnit.level}`;
  }
  if (command.propId === 5) {
    const gain = rng.next() < 0.55;
    player.hp = Math.max(0, Math.min(player.maxHp, player.hp + (gain ? 1 : -1)));
    player.lastEvent = gain ? "包子生效：阿斗+1命" : "包子反噬：阿斗-1命";
  }
  if (command.propId === 6 && ownUnit) {
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
  emitBattleEvent(snapshot, {
    type: "prop-used", slot: player.slot, propId: command.propId,
    ...(command.targetUnitId === undefined ? {} : { targetUnitId: command.targetUnitId }),
    ...(command.targetEnemyId === undefined ? {} : { targetEnemyId: command.targetEnemyId }),
    ...(command.targetCell === undefined ? {} : { targetCell: command.targetCell }),
    ...(command.reserveId === undefined ? {} : { reserveId: command.reserveId }),
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
    case "CLAIM_SHOVEL_SUPPLY": return claimShovelSupply(snapshot, player);
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
  hydrateSnapshot(snapshot);
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
  hydrateSnapshot(snapshot);
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
  return result;
}

function spawnEnemy(snapshot: MatchSnapshot, player: PlayerBattleState) {
  const waveIndex = player.wave - 1;
  const wave = WAVES[waveIndex] ?? WAVES[0];
  const curve = DIFFICULTY_CURVES[snapshot.difficultyCurve] ?? DIFFICULTY_CURVES[0];
  const multiplier = curve[waveIndex] ?? 1;
  const isLastSpawn = player.remainingToSpawn === 1;
  const boss = isLastSpawn && snapshot.bossWaves.includes(player.wave);
  const hp = Math.round(wave[1] * multiplier * (boss ? 7 : 1));
  player.enemies.push({
    id: `e-${player.slot}-${player.wave}-${player.remainingToSpawn}-${snapshot.tick}`,
    hp, maxHp: hp, progress: 0, boss, stunnedMs: 0,
  });
  player.remainingToSpawn -= 1;
}

function damage(enemy: PlayerBattleState["enemies"][number], amount: number) {
  enemy.hp -= amount;
}

function attack(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  const opponent = snapshot.players[player.slot === 0 ? 1 : 0];
  for (const unit of player.units) {
    const stats = unitStats(unit, player, opponent);
    if (!stats) continue;
    // 空窗期只让冷却恢复到“可攻击”，绝不能积累负冷却债务；否则敌人
    // 入射程后会每个 Tick 补发一次历史攻击。保留本 Tick 的少量超时量，
    // 让固定步长下的平均攻击间隔继续贴近配置值。
    const elapsedCooldown = Math.max(0, unit.cooldownMs) - deltaMs;
    unit.cooldownMs = Math.max(0, elapsedCooldown);
    if (player.enemies.length === 0) continue;
    const firstPosition = cellCoords(unit.cell);
    const secondPosition = unit.secondaryCell === undefined ? firstPosition : cellCoords(unit.secondaryCell);
    const position = { x: (firstPosition.x + secondPosition.x) / 2, y: (firstPosition.y + secondPosition.y) / 2 };
    const inRange = player.enemies.filter((enemy) => {
      if (enemy.hp <= 0) return false;
      const point = pathPoint(snapshot.mapIndex, enemy.progress);
      return attackRangeIntersectsCell(position, point, stats.range);
    });
    if (inRange.length === 0 || elapsedCooldown > 0) continue;
    const target = unit.kind === "弓" || unit.kind === "黄忠" || unit.kind === "黄祖"
      ? [...inRange].sort((a, b) => b.progress - a.progress)[0]!
      : [...inRange].sort((a, b) => {
          const pa = pathPoint(snapshot.mapIndex, a.progress); const pb = pathPoint(snapshot.mapIndex, b.progress);
          return Math.hypot(pa.x - position.x, pa.y - position.y) - Math.hypot(pb.x - position.x, pb.y - position.y);
        })[0]!;
    damage(target, stats.attack);
    unit.attackCount += 1;
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
      damage: stats.attack,
      hitCount: 1,
      special: false,
    } as Extract<BattleEventPayload, { type: "attack" }>);

    if (unit.kind === "枪") {
      const next = inRange.filter((enemy) => enemy.id !== target.id).sort((a, b) => Math.abs(a.progress - target.progress) - Math.abs(b.progress - target.progress))[0];
      if (next) { damage(next, stats.attack * 0.5); effect.hitCount += 1; }
    }
    if (unit.kind === "骑") {
      for (const enemy of inRange) if (enemy.id !== target.id && Math.abs(enemy.progress - target.progress) < 0.08) {
        damage(enemy, stats.attack * 0.5); effect.hitCount += 1;
      }
    }
    if (unit.kind === "赵云" && unit.attackCount % 30 === 0) { damage(target, stats.attack * 7); effect.damage += stats.attack * 7; effect.special = true; }
    if (unit.kind === "张飞" && unit.attackCount % 15 === 0) { for (const enemy of inRange) enemy.stunnedMs = Math.max(enemy.stunnedMs, 2000); effect.special = true; effect.hitCount = Math.max(effect.hitCount, inRange.length); }
    if (unit.kind === "关平" && unit.attackCount % 15 === 0) { for (const enemy of inRange) enemy.stunnedMs = Math.max(enemy.stunnedMs, 1000); effect.special = true; effect.hitCount = Math.max(effect.hitCount, inRange.length); }
    if (unit.kind === "关羽" && unit.attackCount % 20 === 0) { damage(target, stats.attack * 5); effect.damage += stats.attack * 5; effect.special = true; }
    if (unit.kind === "黄忠" && unit.attackCount % 30 === 0) { damage(target, stats.attack * 2); effect.damage += stats.attack * 2; effect.special = true; }
    if (unit.kind === "黄祖" && unit.attackCount % 30 === 0) { for (const enemy of inRange) damage(enemy, stats.attack); effect.special = true; effect.hitCount = Math.max(effect.hitCount, inRange.length); }
    if (unit.kind === "刘备" && unit.attackCount % 20 === 0) { damage(target, stats.attack * 5); effect.damage += stats.attack * 5; effect.special = true; }
    if (unit.kind === "马超") {
      const chance = target.boss ? 0.1 : 0.3;
      const roll = createRng(snapshot.seed ^ snapshot.tick ^ unit.attackCount ^ unit.id.length).next();
      if (roll < chance) { target.stunnedMs = Math.max(target.stunnedMs, target.boss ? 200 : 500); effect.special = true; }
    }
  }
  const defeated = player.enemies.filter((enemy) => enemy.hp <= 0);
  if (defeated.length) {
    player.enemies = player.enemies.filter((enemy) => enemy.hp > 0);
    const reward = defeated.reduce((sum, enemy) => sum + (enemy.boss ? GAME_CONFIG.bossKillBuns : GAME_CONFIG.normalKillBuns), 0);
    player.buns += reward;
    for (const enemy of defeated) emitBattleEvent(snapshot, {
      type: "enemy-defeated", slot: player.slot, enemyId: enemy.id, boss: enemy.boss,
      rewardBuns: enemy.boss ? GAME_CONFIG.bossKillBuns : GAME_CONFIG.normalKillBuns,
    });
    player.lastEvent = defeated.some((enemy) => enemy.boss) ? `击败Boss，+${reward}馒头` : `击败敌人，+${reward}馒头`;
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

function tickProps(snapshot: MatchSnapshot, player: PlayerBattleState, deltaMs: number) {
  const props = ensureProps(player);
  for (const id of props.loadout.active) props.cooldowns[id] = Math.max(0, (props.cooldowns[id] ?? 0) - deltaMs);
  for (const unit of player.units) {
    if ((unit.temporaryAttackSpeedMs ?? 0) > 0) {
      unit.temporaryAttackSpeedMs = Math.max(0, (unit.temporaryAttackSpeedMs ?? 0) - deltaMs);
      if (unit.temporaryAttackSpeedMs === 0) unit.temporaryAttackSpeedMultiplier = 1;
    }
    if (unit.kind === "农") {
      unit.incomeMs = (unit.incomeMs ?? 20_000) - deltaMs;
      if (unit.incomeMs <= 0) { player.buns += 1; unit.incomeMs += 20_000; }
    }
  }
  for (const item of player.reserve) if (item.kind === "农") {
    item.incomeMs = (item.incomeMs ?? 20_000) - deltaMs;
    if (item.incomeMs <= 0) { player.buns += 1; item.incomeMs += 20_000; }
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
      const point = pathPoint(snapshot.mapIndex, enemy.progress);
      return endCells.some((cell) => Math.hypot(point.x - cell.x, point.y - cell.y) <= 1);
    });
    if (threatened && props.meteorMs === 0) {
      const defeatedIds = player.enemies.filter((enemy) => {
        const point = pathPoint(snapshot.mapIndex, enemy.progress);
        return endCells.some((cell) => Math.hypot(point.x - cell.x, point.y - cell.y) <= 1);
      }).map((enemy) => enemy.id);
      player.enemies = player.enemies.filter((enemy) => {
        const point = pathPoint(snapshot.mapIndex, enemy.progress);
        return !endCells.some((cell) => Math.hypot(point.x - cell.x, point.y - cell.y) <= 1);
      });
      props.meteorMs = 300_000;
      player.lastEvent = "陨石落下，清除阿斗附近敌军";
      emitBattleEvent(snapshot, { type: "prop-triggered", slot: player.slot, propId: 20, targetIds: defeatedIds });
    }
  }

  for (const placed of [...props.placed]) {
    const cell = cellCoords(placed.cell);
    const trigger = player.enemies.find((enemy) => {
      const point = pathPoint(snapshot.mapIndex, enemy.progress);
      return Math.hypot(point.x - cell.x, point.y - cell.y) <= 0.25;
    });
    if (!trigger) continue;
    let targetIds: string[];
    if (placed.propId === 8) {
      trigger.stunnedMs = Math.max(trigger.stunnedMs, 5_000);
      targetIds = [trigger.id];
    }
    else {
      targetIds = player.enemies.filter((enemy) => {
        const point = pathPoint(snapshot.mapIndex, enemy.progress);
        return Math.hypot(point.x - cell.x, point.y - cell.y) <= 0.75;
      }).map((enemy) => enemy.id);
      player.enemies = player.enemies.filter((enemy) => {
        const point = pathPoint(snapshot.mapIndex, enemy.progress);
        return Math.hypot(point.x - cell.x, point.y - cell.y) > 0.75;
      });
    }
    props.placed = props.placed.filter((candidate) => candidate.id !== placed.id);
    player.lastEvent = placed.propId === 8 ? "陷阱触发：敌人眩晕5秒" : "地雷触发：范围敌军被消灭";
    emitBattleEvent(snapshot, { type: "prop-triggered", slot: player.slot, propId: placed.propId, targetIds });
  }
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
  player.spawnMs -= deltaMs;
  if (player.remainingToSpawn > 0 && player.spawnMs <= 0) {
    spawnEnemy(snapshot, player);
    player.spawnMs += GAME_CONFIG.spawnMs;
  }
  attack(snapshot, player, deltaMs);
  for (const enemy of player.enemies) {
    enemy.stunnedMs = Math.max(0, enemy.stunnedMs - deltaMs);
    const siltMultiplier = hasPassive(player, 18) ? 0.9 : 1;
    if (enemy.stunnedMs === 0) enemy.progress += deltaMs * (enemy.boss ? 0.000018 : 0.000026) * siltMultiplier;
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
  hydrateSnapshot(snapshot);
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
  hydrateSnapshot(clone);
  return clone;
}
