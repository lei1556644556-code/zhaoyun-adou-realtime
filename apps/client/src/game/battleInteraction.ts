import {
  BATTLE_BUFFS, GAME_CONFIG, PROPS, cellCode, cellCoords, cellIndex, enemyPathPoint,
  type ActivePropId, type BattleBuffKind, type GameCommand, type MatchSnapshot, type PlayerSlot,
} from "@adou/shared";

export const BATTLE_INPUT = {
  mouseDragThresholdPx: 7,
  touchDragThresholdPx: 11,
  tokenHitRadius: 42,
} as const;

export const BATTLE_LAYOUT = {
  width: GAME_CONFIG.designWidth,
  mapTop: GAME_CONFIG.mapTop,
  cellSize: GAME_CONFIG.cellSize,
  campX: 95,
  campY: 1050,
  campCell: 90,
} as const;

export type DragSource = "reserve" | "unit" | "generalPart";
export type Point = Readonly<{ x: number; y: number }>;
export type BattleInspectSelection = Readonly<{ ownerSlot: PlayerSlot; unitId?: string; reserveId?: string }>;
export type BattleInspectPayload = BattleInspectSelection & Readonly<{ kind: string; level: number }>;

export interface PointerGesture {
  pointerId: number;
  start: Point;
  current: Point;
  threshold: number;
  dragging: boolean;
}

export type PointerGestureUpdate = Readonly<{
  gesture: PointerGesture;
  accepted: boolean;
  beganDrag: boolean;
}>;

export type BattleDropTarget =
  | Readonly<{ type: "cell"; targetCell: number }>
  | Readonly<{ type: "camp"; targetSlot: number }>
  | Readonly<{ type: "outside" }>;

export type BattleDropPayload =
  | Readonly<{ sourceType: "reserve"; id: string; targetCell: number }>
  | Readonly<{ sourceType: "unit"; id: string; targetCell: number }>
  | Readonly<{ sourceType: "generalPart"; id: string; partIndex: 0 | 1; targetCell: number }>;

export type BattleCampDropPayload = Readonly<{
  sourceType: "reserve" | "unit";
  id: string;
  targetSlot: number;
}>;

export type ActivePropDropPayload =
  | Readonly<{ propId: ActivePropId; targetUnitId: string }>
  | Readonly<{ propId: ActivePropId; targetEnemyId: string }>
  | Readonly<{ propId: ActivePropId; targetCell: number }>
  | Readonly<{ propId: ActivePropId; reserveId: string }>;

export type BattleBuffDropPayload =
  | Readonly<{ buffInstanceId: string; buffKind: BattleBuffKind; targetEnemyId: string }>
  | Readonly<{ buffInstanceId: string; buffKind: BattleBuffKind; targetCell: number }>;

export function createPointerGesture(pointerId: number, start: Point, threshold: number): PointerGesture {
  return { pointerId, start, current: start, threshold, dragging: false };
}

export function worldDragThreshold(wasTouch: boolean, displayScale: Point) {
  const cssPixels = wasTouch ? BATTLE_INPUT.touchDragThresholdPx : BATTLE_INPUT.mouseDragThresholdPx;
  return cssPixels * Math.max(displayScale.x, displayScale.y);
}

export function updatePointerGesture(gesture: PointerGesture, pointerId: number, current: Point): PointerGestureUpdate {
  if (gesture.pointerId !== pointerId) return { gesture, accepted: false, beganDrag: false };
  const distance = Math.hypot(current.x - gesture.start.x, current.y - gesture.start.y);
  const dragging = gesture.dragging || distance >= gesture.threshold;
  return {
    gesture: { ...gesture, current, dragging },
    accepted: true,
    beganDrag: dragging && !gesture.dragging,
  };
}

export function isTapGesture(gesture: PointerGesture) {
  const distance = Math.hypot(gesture.current.x - gesture.start.x, gesture.current.y - gesture.start.y);
  return !gesture.dragging && distance < gesture.threshold;
}

/**
 * Resolves tap details from the latest authoritative snapshot. A snapshot can
 * arrive between pointerdown and pointerup, so the press-time level is not a
 * safe source for the inspector.
 */
export function resolveBattleInspection(
  snapshot: MatchSnapshot,
  selection: BattleInspectSelection,
): BattleInspectPayload | null {
  const owner = snapshot.players[selection.ownerSlot];
  const piece = selection.unitId
    ? owner.units.find((candidate) => candidate.id === selection.unitId)
    : selection.reserveId
      ? owner.reserve.find((candidate) => candidate.id === selection.reserveId)
      : undefined;
  return piece ? { kind: piece.kind, level: piece.level, ...selection } : null;
}

/**
 * Converts world coordinates to a UI intent only. Whether a placement, merge,
 * replacement, or split is legal remains the battle engine's responsibility.
 */
export function battleDropTargetAt(point: Point, sourceType: DragSource): BattleDropTarget {
  const { width, mapTop, cellSize, campX, campY, campCell } = BATTLE_LAYOUT;
  if (point.x >= 0 && point.x < width && point.y >= mapTop && point.y < mapTop + GAME_CONFIG.rows * cellSize) {
    return {
      type: "cell",
      targetCell: cellIndex(Math.floor(point.x / cellSize), Math.floor((point.y - mapTop) / cellSize)),
    };
  }
  if (sourceType !== "generalPart"
    && point.x >= campX && point.x < campX + GAME_CONFIG.reserveSize * campCell
    && point.y >= campY && point.y < campY + campCell) {
    return { type: "camp", targetSlot: Math.floor((point.x - campX) / campCell) };
  }
  return { type: "outside" };
}

export function commandForBattleDrop(payload: BattleDropPayload): GameCommand {
  if (payload.sourceType === "reserve") {
    return { type: "DROP_RESERVE", reserveId: payload.id, targetCell: payload.targetCell };
  }
  if (payload.sourceType === "generalPart") {
    return { type: "SPLIT_GENERAL", unitId: payload.id, partIndex: payload.partIndex, targetCell: payload.targetCell };
  }
  return { type: "DROP_UNIT", unitId: payload.id, targetCell: payload.targetCell };
}

export function commandForBattleCampDrop(payload: BattleCampDropPayload): GameCommand {
  return payload.sourceType === "reserve"
    ? { type: "DROP_RESERVE_TO_SLOT", reserveId: payload.id, targetSlot: payload.targetSlot }
    : { type: "DROP_UNIT_TO_RESERVE", unitId: payload.id, targetSlot: payload.targetSlot };
}

/**
 * Resolves only the visible object beneath a dragged prop. Cooldowns, occupied
 * road cells, eligible unit kinds, and every other rule stay authoritative in
 * the shared simulation.
 */
export function activePropDropTargetAt(
  snapshot: MatchSnapshot,
  viewerSlot: PlayerSlot,
  propId: ActivePropId,
  point: Point,
): ActivePropDropPayload | null {
  const target = PROPS[propId]?.target;
  const mine = snapshot.players[viewerSlot];
  const opponent = snapshot.players[viewerSlot === 0 ? 1 : 0];

  if (target === "reserve") {
    const camp = battleDropTargetAt(point, "reserve");
    if (camp.type !== "camp") return null;
    const item = mine.reserve.find((candidate) => candidate.slot === camp.targetSlot || candidate.secondarySlot === camp.targetSlot);
    return item ? { propId, reserveId: item.id } : null;
  }

  const board = battleDropTargetAt(point, "generalPart");
  if (board.type !== "cell") return null;
  if (target === "road-cell") {
    return cellCode(snapshot.mapIndex, board.targetCell) === "0_0" ? { propId, targetCell: board.targetCell } : null;
  }
  if (target === "own-unit") {
    const unit = mine.units.find((candidate) => candidate.cell === board.targetCell || candidate.secondaryCell === board.targetCell);
    return unit ? { propId, targetUnitId: unit.id } : null;
  }
  if (target === "enemy-area") {
    const displayed = cellCoords(board.targetCell);
    const canonicalCell = cellIndex(GAME_CONFIG.columns - 1 - displayed.x, GAME_CONFIG.rows - 1 - displayed.y);
    const unit = opponent.units.find((candidate) => candidate.cell === canonicalCell || candidate.secondaryCell === canonicalCell);
    return unit ? { propId, targetEnemyId: unit.id } : null;
  }
  return null;
}

export function commandForActivePropDrop(payload: ActivePropDropPayload): GameCommand {
  return { type: "USE_PROP", ...payload };
}

/** 命中玩家视角上半场、正在进攻对手的怪物；最终合法性仍由权威模拟校验。 */
export function battleBuffDropTargetAt(
  snapshot: MatchSnapshot,
  viewerSlot: PlayerSlot,
  buffInstanceId: string,
  buffKind: BattleBuffKind,
  point: Point,
): BattleBuffDropPayload | null {
  const config = BATTLE_BUFFS.find((candidate) => candidate.kind === buffKind);
  if (config?.target === "cell") {
    const board = battleDropTargetAt(point, "generalPart");
    if (board.type !== "cell") return null;
    const displayed = cellCoords(board.targetCell);
    if (displayed.y >= GAME_CONFIG.rows / 2) return null;
    return {
      buffInstanceId, buffKind,
      targetCell: cellIndex(GAME_CONFIG.columns - 1 - displayed.x, GAME_CONFIG.rows - 1 - displayed.y),
    };
  }
  const opponent = snapshot.players[viewerSlot === 0 ? 1 : 0];
  let best: { id: string; distance: number } | null = null;
  for (const enemy of opponent.enemies) {
    if (enemy.hp <= 0 || enemy.progress >= 1) continue;
    const canonical = enemyPathPoint(snapshot.mapIndex, enemy);
    const displayed = {
      x: (GAME_CONFIG.columns - 1 - canonical.x + 0.5) * GAME_CONFIG.cellSize,
      y: GAME_CONFIG.mapTop + (GAME_CONFIG.rows - 1 - canonical.y + 0.5) * GAME_CONFIG.cellSize,
    };
    const distance = Math.hypot(displayed.x - point.x, displayed.y - point.y);
    const scale = (enemy.scaleMultiplier ?? 1) * (enemy.battleGiantApplied ? 2 : 1);
    if (distance > BATTLE_INPUT.tokenHitRadius * Math.max(1, scale) || (best && best.distance <= distance)) continue;
    best = { id: enemy.id, distance };
  }
  return best ? { buffInstanceId, buffKind, targetEnemyId: best.id } : null;
}

export function commandForBattleBuffDrop(payload: BattleBuffDropPayload): GameCommand {
  return { type: "USE_BATTLE_BUFF", buffInstanceId: payload.buffInstanceId,
    ...( "targetEnemyId" in payload ? { targetEnemyId: payload.targetEnemyId } : { targetCell: payload.targetCell }) };
}
