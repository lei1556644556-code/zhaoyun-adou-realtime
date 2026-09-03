import {
  BOSS_CHANCES, BOSS_MILESTONES, DIFFICULTY_CURVES, DIFFICULTY_WEIGHTS,
  GAME_CONFIG, GENERALS, HERO_PAIRS, LEVEL_ATTACK, LEVEL_SPEED, SOLDIERS, TOKEN_POOL, WAVES,
  cellCode, cellCoords, initialOpenCells, pathPoint,
} from "./config";
import type {
  CommandResult, GameCommand, MatchSnapshot, PlayerBattleState, PlayerSlot, ReserveItem, UnitState,
} from "./types";

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

function weightedIndex(rng: Rng, weights: readonly number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng.next() * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index] ?? 0;
    if (roll < 0) return index;
  }
  return weights.length - 1;
}

function createPlayer(slot: PlayerSlot, mapIndex: number): PlayerBattleState {
  const firstWave = WAVES[0];
  return {
    slot, hp: GAME_CONFIG.baseHp, maxHp: GAME_CONFIG.baseHp,
    buns: GAME_CONFIG.startBuns, recruitCost: GAME_CONFIG.recruitBase, recruitCount: 0,
    wave: 1, phase: "preparing", prepareMs: GAME_CONFIG.prepareMs,
    interwaveMs: 0, spawnMs: GAME_CONFIG.spawnMs, remainingToSpawn: firstWave[0],
    units: [], reserve: [], unlockedCells: initialOpenCells(mapIndex), enemies: [], lastEvent: "等待双方布阵",
  };
}

export function createMatch(roomId: string, seed: number, mapIndex = 0): MatchSnapshot {
  const normalizedMap = Math.max(0, Math.min(3, Math.floor(mapIndex)));
  const planningRng = createRng(seed);
  const difficultyCurve = weightedIndex(planningRng, DIFFICULTY_WEIGHTS);
  const bossWaves = BOSS_MILESTONES.filter((_, index) => planningRng.next() < (BOSS_CHANCES[index] ?? 0));
  return {
    roomId, tick: 0, stateVersion: 0, seed, mapIndex: normalizedMap, phase: "preparing", difficultyCurve, bossWaves,
    players: [createPlayer(0, normalizedMap), createPlayer(1, normalizedMap)], combatEvents: [], winner: null, serverTime: Date.now(),
  };
}

function unitStats(unit: UnitState) {
  const hero = GENERALS[unit.kind];
  const soldier = SOLDIERS[unit.kind as keyof typeof SOLDIERS];
  const base = hero ?? soldier;
  if (!base) return null;
  const levelIndex = Math.min(unit.level, base.maxLevel) - 1;
  return {
    attack: base.attack * (LEVEL_ATTACK[levelIndex] ?? 1),
    intervalMs: base.intervalMs / (LEVEL_SPEED[levelIndex] ?? 1),
    range: base.range,
    maxLevel: base.maxLevel,
  };
}

function recycleValue(items: readonly ReserveItem[]) {
  return items.reduce((sum, item) => sum + (item.kind === "铲子" ? 1 : 2 ** Math.max(0, item.level - 1)), 0);
}

function recruit(player: PlayerBattleState, rng: Rng): string | null {
  const recycled = recycleValue(player.reserve);
  if (player.buns + recycled < player.recruitCost) return "馒头不足";
  player.buns += recycled - player.recruitCost;
  player.recruitCount += 1;
  player.recruitCost = GAME_CONFIG.recruitBase + player.recruitCount * GAME_CONFIG.recruitStep;
  player.reserve = Array.from({ length: GAME_CONFIG.reserveSize }, (_, slot) => {
    const kindIndex = weightedIndex(rng, TOKEN_POOL.map((entry) => entry[1]));
    const kind = TOKEN_POOL[kindIndex]?.[0] ?? "刀";
    return { id: `r-${player.slot}-${player.recruitCount}-${slot}-${Math.floor(rng.next() * 1e7)}`, kind, level: 1, slot };
  });
  player.lastEvent = recycled > 0
    ? `回收${recycled}馒头，征得五枚棋子`
    : `征兵五枚：${player.reserve.map((item) => item.kind).join("、")}`;
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
    [target.x, target.y - 1], [target.x, target.y + 1],
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
    ...(secondarySlot === undefined ? {} : {
      secondarySlot,
      parts: unit.parts ?? [unit.kind[0] ?? "", unit.kind[1] ?? ""] as [string, string],
    }),
  };
}

function adjacentCellForGeneral(player: PlayerBattleState, target: UnitState, source?: UnitState) {
  const targetPoint = cellCoords(target.cell);
  if (source) {
    const sourcePoint = cellCoords(source.cell);
    if (Math.abs(sourcePoint.x - targetPoint.x) + Math.abs(sourcePoint.y - targetPoint.y) === 1) return source.cell;
  }
  const candidates = [
    [targetPoint.x - 1, targetPoint.y], [targetPoint.x + 1, targetPoint.y],
    [targetPoint.x, targetPoint.y - 1], [targetPoint.x, targetPoint.y + 1],
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
    [target.x, target.y - 1], [target.x, target.y + 1],
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
    if (companionCell === null) return "武将需要占用相邻两格，请先腾出空位";
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
      return null;
    }
    const excluded = new Set([item.id, target.id]);
    const sourceCompanion = item.secondarySlot === undefined
      ? undefined
      : target.secondaryCell === undefined
        ? adjacentCellExcluding(player, targetCell, excluded) ?? undefined
        : target.cell === targetCell ? target.secondaryCell : target.cell;
    if (item.secondarySlot !== undefined && sourceCompanion === undefined) return "替换两格武将需要棋盘相邻空格";
    const targetCompanion = target.secondaryCell === undefined
      ? undefined
      : adjacentReserveSlotExcluding(player, item.slot, excluded) ?? undefined;
    if (target.secondaryCell !== undefined && targetCompanion === undefined) return "替换两格武将需要营地相邻空格";
    const sourceCells = sourceCompanion === undefined ? [targetCell] : [targetCell, sourceCompanion].sort((a, b) => a - b);
    const targetSlots = targetCompanion === undefined ? [item.slot] : [item.slot, targetCompanion].sort((a, b) => a - b);
    player.reserve = player.reserve.filter((candidate) => candidate.id !== item.id);
    player.units = player.units.filter((candidate) => candidate.id !== target.id);
    player.units.push(reserveToUnit(item, sourceCells[0]!, sourceCells[1]));
    player.reserve.push(unitToReserve(target, targetSlots[0]!, targetSlots[1]));
    player.lastEvent = `上阵「${item.kind}」，替换「${target.kind}」`;
    return null;
  }
  if (item.secondarySlot !== undefined && GENERALS[item.kind]) {
    const companionCell = emptyAdjacentBuildCell(player, targetCell);
    if (companionCell === null) return "两字武将需要占用棋盘相邻两格";
    const cells = [targetCell, companionCell].sort((a, b) => a - b);
    player.units.push({
      id: item.id.replace(/^r-/, "u-"), kind: item.kind, level: item.level,
      cell: cells[0]!, secondaryCell: cells[1]!, parts: item.parts ?? [item.kind[0] ?? "", item.kind[1] ?? ""],
      cooldownMs: 0, attackCount: 0,
    });
    player.reserve = player.reserve.filter((candidate) => candidate.id !== reserveId);
    player.lastEvent = `上阵武将「${item.kind}」`;
    return null;
  }
  player.units.push({
    id: item.id.replace(/^r-/, "u-"), kind: item.kind, level: item.level, cell: targetCell,
    cooldownMs: 0, attackCount: 0,
  });
  player.reserve = player.reserve.filter((candidate) => candidate.id !== reserveId);
  player.lastEvent = `上阵「${item.kind}」`;
  return null;
}

function dropReserveToSlot(player: PlayerBattleState, reserveId: string, targetSlot: number): string | null {
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
  return null;
}

function dropUnitToReserve(player: PlayerBattleState, unitId: string, targetSlot: number): string | null {
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
      return null;
    }
    const excluded = new Set([source.id, target.id]);
    const targetCompanion = target.secondarySlot === undefined
      ? undefined
      : adjacentCellExcluding(player, source.cell, excluded) ?? undefined;
    if (target.secondarySlot !== undefined && targetCompanion === undefined) return "替换两格武将需要棋盘相邻空格";
    const targetCells = targetCompanion === undefined ? [source.cell] : [source.cell, targetCompanion].sort((a, b) => a - b);
    player.units = player.units.filter((unit) => unit.id !== source.id);
    player.reserve = player.reserve.filter((item) => item.id !== target.id);
    player.reserve.push(unitToReserve(source, targetSlot));
    player.units.push(reserveToUnit(target, targetCells[0]!, targetCells[1]));
    player.lastEvent = `「${source.kind}」回营，替换「${target.kind}」`;
    return null;
  }
  player.units = player.units.filter((unit) => unit.id !== source.id);
  player.reserve.push({ id: source.id.replace(/^u-/, "r-"), kind: source.kind, level: source.level, slot: targetSlot });
  player.lastEvent = `「${source.kind}」返回营地`;
  return null;
}

function dropUnit(player: PlayerBattleState, unitId: string, targetCell: number): string | null {
  if (!canBuild(player, targetCell)) return "只能放入己方已开放白格";
  const source = player.units.find((candidate) => candidate.id === unitId);
  if (!source) return "单位不存在";
  const target = unitAtCell(player, targetCell);
  if (!target) {
    if (source.secondaryCell !== undefined) return "两格武将需要先拆字再移动";
    source.cell = targetCell;
    player.lastEvent = `移动「${source.kind}」`;
    return null;
  }
  if (target.id === source.id) return null;
  if (isMergeAttempt(source, target)) {
    const error = combine(player, source, target, source);
    if (error) return error;
    player.units = player.units.filter((candidate) => candidate.id !== source.id);
    player.lastEvent = `合成「${target.kind}」Lv.${target.level}`;
    return null;
  }
  const sourceCell = source.cell;
  if (target.secondaryCell === undefined) {
    source.cell = targetCell;
    target.cell = sourceCell;
  } else {
    const companionCell = adjacentCellExcluding(player, sourceCell, new Set([source.id, target.id]));
    if (companionCell === null) return "交换两格武将需要原位旁有相邻空格";
    const targetCells = [sourceCell, companionCell].sort((a, b) => a - b);
    source.cell = targetCell;
    target.cell = targetCells[0]!;
    target.secondaryCell = targetCells[1]!;
  }
  player.lastEvent = `交换「${source.kind}」与「${target.kind}」`;
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
  player.units = player.units.filter((unit) => unit.id !== general.id);
  player.units.push(makePart(otherIndex, cells[otherIndex]), makePart(partIndex, targetCell));
  player.lastEvent = `拆分「${general.kind}」为「${parts[0]}」「${parts[1]}」`;
  return null;
}

function mergeById(player: PlayerBattleState, sourceId: string, targetId: string): string | null {
  if (sourceId === targetId) return "不能与自身合成";
  const source = player.units.find((item) => item.id === sourceId);
  const target = player.units.find((item) => item.id === targetId);
  if (!source || !target) return "单位不存在";
  return dropUnit(player, sourceId, target.cell);
}

export function applyCommand(snapshot: MatchSnapshot, slot: PlayerSlot, command: GameCommand): CommandResult {
  const player = snapshot.players[slot];
  if (snapshot.phase === "finished") return { commandId: "", ok: false, code: "ERR_MATCH_ENDED", message: "对局已结束", stateVersion: snapshot.stateVersion };
  const rng = createRng(snapshot.seed ^ ((snapshot.stateVersion + 1) * 0x9E3779B1) ^ (slot * 977));
  let error: string | null = null;
  if (command.type === "RECRUIT") error = recruit(player, rng);
  if (command.type === "DROP_RESERVE") error = dropReserve(snapshot, player, command.reserveId, command.targetCell);
  if (command.type === "DROP_RESERVE_TO_SLOT") error = dropReserveToSlot(player, command.reserveId, command.targetSlot);
  if (command.type === "DROP_UNIT") error = dropUnit(player, command.unitId, command.targetCell);
  if (command.type === "DROP_UNIT_TO_RESERVE") error = dropUnitToReserve(player, command.unitId, command.targetSlot);
  if (command.type === "SPLIT_GENERAL") error = splitGeneral(snapshot, player, command.unitId, command.partIndex, command.targetCell);
  if (command.type === "MOVE") error = dropUnit(player, command.unitId, command.targetCell);
  if (command.type === "MERGE") error = mergeById(player, command.sourceId, command.targetId);
  if (error) return {
    commandId: "", ok: false, code: error === "馒头不足" ? "ERR_NOT_ENOUGH_BUN" : "ERR_INVALID_COMMAND",
    message: error, stateVersion: snapshot.stateVersion,
  };
  snapshot.stateVersion += 1;
  return { commandId: "", ok: true, stateVersion: snapshot.stateVersion };
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
  for (const unit of player.units) {
    const stats = unitStats(unit);
    if (!stats || player.enemies.length === 0) continue;
    unit.cooldownMs -= deltaMs;
    if (unit.cooldownMs > 0) continue;
    const firstPosition = cellCoords(unit.cell);
    const secondPosition = unit.secondaryCell === undefined ? firstPosition : cellCoords(unit.secondaryCell);
    const position = { x: (firstPosition.x + secondPosition.x) / 2, y: (firstPosition.y + secondPosition.y) / 2 };
    const inRange = player.enemies.filter((enemy) => {
      const point = pathPoint(snapshot.mapIndex, enemy.progress);
      return Math.hypot(point.x - position.x, point.y - position.y) <= stats.range;
    });
    if (inRange.length === 0) continue;
    const target = unit.kind === "弓" || unit.kind === "黄忠" || unit.kind === "黄祖"
      ? [...inRange].sort((a, b) => b.progress - a.progress)[0]!
      : [...inRange].sort((a, b) => {
          const pa = pathPoint(snapshot.mapIndex, a.progress); const pb = pathPoint(snapshot.mapIndex, b.progress);
          return Math.hypot(pa.x - position.x, pa.y - position.y) - Math.hypot(pb.x - position.x, pb.y - position.y);
        })[0]!;
    damage(target, stats.attack);
    unit.attackCount += 1;
    unit.cooldownMs += stats.intervalMs;
    const effect = {
      id: `fx-${snapshot.tick}-${player.slot}-${unit.id}-${unit.attackCount}`,
      slot: player.slot,
      unitId: unit.id,
      unitKind: unit.kind,
      sourceCell: unit.cell,
      secondaryCell: unit.secondaryCell,
      targetId: target.id,
      targetProgress: target.progress,
      targetBoss: target.boss,
      damage: stats.attack,
      hitCount: 1,
      special: false,
    };
    snapshot.combatEvents.push(effect);

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
    player.lastEvent = defeated.some((enemy) => enemy.boss) ? `击败Boss，+${reward}馒头` : `击败敌人，+${reward}馒头`;
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
  player.spawnMs -= deltaMs;
  if (player.remainingToSpawn > 0 && player.spawnMs <= 0) {
    spawnEnemy(snapshot, player);
    player.spawnMs += GAME_CONFIG.spawnMs;
  }
  attack(snapshot, player, deltaMs);
  for (const enemy of player.enemies) {
    enemy.stunnedMs = Math.max(0, enemy.stunnedMs - deltaMs);
    if (enemy.stunnedMs === 0) enemy.progress += deltaMs * (enemy.boss ? 0.000018 : 0.000026);
  }
  const escaped = player.enemies.filter((enemy) => enemy.progress >= 1);
  if (escaped.length) {
    player.enemies = player.enemies.filter((enemy) => enemy.progress < 1);
    player.hp = Math.max(0, player.hp - escaped.length);
    player.buns += escaped.length * GAME_CONFIG.hpLostBuns;
    player.lastEvent = `阿斗受击 ×${escaped.length}，+${escaped.length * GAME_CONFIG.hpLostBuns}馒头`;
  }
  if (player.remainingToSpawn === 0 && player.enemies.length === 0) {
    player.interwaveMs += deltaMs;
    if (player.interwaveMs >= GAME_CONFIG.interwaveMs) advanceWave(player);
  }
}

export function stepMatch(snapshot: MatchSnapshot, deltaMs: number) {
  if (snapshot.phase === "finished" || snapshot.phase === "waiting") return snapshot;
  snapshot.combatEvents = [];
  snapshot.tick += 1;
  snapshot.serverTime += deltaMs;
  snapshot.players.forEach((player) => tickPlayer(snapshot, player, deltaMs));
  if (snapshot.players.some((player) => player.phase === "battle")) snapshot.phase = "battle";
  const dead = snapshot.players.map((player) => player.hp <= 0);
  const survived = snapshot.players.map((player) => player.phase === "finished" && player.hp > 0);
  if (dead[0] || dead[1] || survived[0] || survived[1]) {
    snapshot.phase = "finished";
    if ((dead[0] && dead[1]) || (survived[0] && survived[1])) snapshot.winner = "draw";
    else snapshot.winner = (dead[0] || survived[1]) ? 1 : 0;
    snapshot.players.forEach((player) => { player.phase = "finished"; });
  }
  snapshot.stateVersion += 1;
  return snapshot;
}

export function cloneSnapshot(snapshot: MatchSnapshot): MatchSnapshot {
  return structuredClone(snapshot);
}
