import { describe, expect, it } from "vitest";
import { GAME_CONFIG, cellCoords, cloneSnapshot, createMatch } from "@adou/shared";
import {
  BATTLE_INPUT,
  BATTLE_LAYOUT,
  activePropDropTargetAt,
  battleBuffDropTargetAt,
  battleDropTargetAt,
  commandForActivePropDrop,
  commandForBattleBuffDrop,
  commandForBattleCampDrop,
  commandForBattleDrop,
  createPointerGesture,
  isTapGesture,
  resolveBattleInspection,
  updatePointerGesture,
  worldDragThreshold,
} from "../src/game/battleInteraction";

describe("battle inspection", () => {
  it("reads the latest authoritative level when a snapshot arrives between pointerdown and pointerup", () => {
    const pressedSnapshot = createMatch("inspect-race", 9, 0);
    pressedSnapshot.players[0].units.push({
      id: "blade", kind: "刀", level: 1, cell: 67, cooldownMs: 0, attackCount: 0,
    });
    const selection = { ownerSlot: 0, unitId: "blade" } as const;
    expect(resolveBattleInspection(pressedSnapshot, selection)?.level).toBe(1);

    const releasedSnapshot = cloneSnapshot(pressedSnapshot);
    releasedSnapshot.players[0].units[0]!.level = 2;

    expect(resolveBattleInspection(releasedSnapshot, selection)).toMatchObject({
      kind: "刀", level: 2, ownerSlot: 0, unitId: "blade",
    });
  });
});

describe("battle pointer gestures", () => {
  it("keeps a short mouse movement as a tap", () => {
    const pressed = createPointerGesture(1, { x: 100, y: 200 }, BATTLE_INPUT.mouseDragThresholdPx);
    const moved = updatePointerGesture(pressed, 1, { x: 104, y: 203 });

    expect(moved.accepted).toBe(true);
    expect(moved.beganDrag).toBe(false);
    expect(isTapGesture(moved.gesture)).toBe(true);
  });

  it("starts a touch drag once and ignores a second pointer", () => {
    const pressed = createPointerGesture(7, { x: 100, y: 200 }, BATTLE_INPUT.touchDragThresholdPx);
    const foreign = updatePointerGesture(pressed, 8, { x: 160, y: 260 });
    const started = updatePointerGesture(foreign.gesture, 7, { x: 111, y: 200 });
    const continued = updatePointerGesture(started.gesture, 7, { x: 140, y: 220 });

    expect(foreign.accepted).toBe(false);
    expect(started.beganDrag).toBe(true);
    expect(continued.beganDrag).toBe(false);
    expect(continued.gesture.dragging).toBe(true);
    expect(isTapGesture(continued.gesture)).toBe(false);
  });

  it("keeps mouse and touch thresholds stable after CSS scaling", () => {
    expect(worldDragThreshold(false, { x: 2, y: 2 })).toBe(BATTLE_INPUT.mouseDragThresholdPx * 2);
    expect(worldDragThreshold(true, { x: 2, y: 2 })).toBe(BATTLE_INPUT.touchDragThresholdPx * 2);
  });
});

describe("battle drop targeting", () => {
  it("maps the battlefield and camp edges without deciding legality", () => {
    expect(battleDropTargetAt({ x: 1, y: BATTLE_LAYOUT.mapTop + 1 }, "reserve"))
      .toEqual({ type: "cell", targetCell: 0 });
    expect(battleDropTargetAt({
      x: BATTLE_LAYOUT.width - 1,
      y: BATTLE_LAYOUT.mapTop + 10 * BATTLE_LAYOUT.cellSize - 1,
    }, "unit")).toEqual({ type: "cell", targetCell: 79 });
    expect(battleDropTargetAt({
      x: BATTLE_LAYOUT.campX + BATTLE_LAYOUT.campCell * 2 + 1,
      y: BATTLE_LAYOUT.campY + 1,
    }, "reserve")).toEqual({ type: "camp", targetSlot: 2 });
    expect(battleDropTargetAt({
      x: BATTLE_LAYOUT.campX + 1,
      y: BATTLE_LAYOUT.campY + 1,
    }, "generalPart")).toEqual({ type: "outside" });
  });
});

describe("battle command wiring", () => {
  it("maps reserve, unit, two-cell general split, camp move, merge and replacement intents to shared commands", () => {
    expect(commandForBattleDrop({ sourceType: "reserve", id: "r-1", targetCell: 13 }))
      .toEqual({ type: "DROP_RESERVE", reserveId: "r-1", targetCell: 13 });
    expect(commandForBattleDrop({ sourceType: "unit", id: "u-1", targetCell: 21 }))
      .toEqual({ type: "DROP_UNIT", unitId: "u-1", targetCell: 21 });
    expect(commandForBattleDrop({ sourceType: "generalPart", id: "u-zhao", partIndex: 1, targetCell: 22 }))
      .toEqual({ type: "SPLIT_GENERAL", unitId: "u-zhao", partIndex: 1, targetCell: 22 });
    expect(commandForBattleCampDrop({ sourceType: "reserve", id: "r-2", targetSlot: 4 }))
      .toEqual({ type: "DROP_RESERVE_TO_SLOT", reserveId: "r-2", targetSlot: 4 });
    expect(commandForBattleCampDrop({ sourceType: "unit", id: "u-2", targetSlot: 0 }))
      .toEqual({ type: "DROP_UNIT_TO_RESERVE", unitId: "u-2", targetSlot: 0 });
  });
});

describe("active prop dragging", () => {
  const cellCenter = (cell: number, mirror = false) => {
    const point = cellCoords(cell);
    const x = mirror ? GAME_CONFIG.columns - 1 - point.x : point.x;
    const y = mirror ? GAME_CONFIG.rows - 1 - point.y : point.y;
    return {
      x: (x + 0.5) * BATTLE_LAYOUT.cellSize,
      y: BATTLE_LAYOUT.mapTop + (y + 0.5) * BATTLE_LAYOUT.cellSize,
    };
  };

  it("resolves own units, mirrored enemy anchors, own road cells and camp items", () => {
    const snapshot = createMatch("prop-drag", 7, 0);
    snapshot.players[0].units.push({
      id: "own-1", kind: "刀", level: 1, cell: 67, cooldownMs: 0, attackCount: 0,
    });
    snapshot.players[1].units.push({
      id: "enemy-anchor", kind: "弓", level: 1, cell: 10, cooldownMs: 0, attackCount: 0,
    });
    snapshot.players[0].reserve.push({ id: "reserve-2", kind: "赵", level: 1, slot: 2 });

    expect(activePropDropTargetAt(snapshot, 0, 3, cellCenter(67)))
      .toEqual({ propId: 3, targetUnitId: "own-1" });
    expect(activePropDropTargetAt(snapshot, 0, 7, cellCenter(10, true)))
      .toEqual({ propId: 7, targetEnemyId: "enemy-anchor" });
    expect(activePropDropTargetAt(snapshot, 0, 8, cellCenter(48)))
      .toEqual({ propId: 8, targetCell: 48 });
    expect(activePropDropTargetAt(snapshot, 0, 21, {
      x: BATTLE_LAYOUT.campX + BATTLE_LAYOUT.campCell * 2.5,
      y: BATTLE_LAYOUT.campY + BATTLE_LAYOUT.campCell / 2,
    })).toEqual({ propId: 21, reserveId: "reserve-2" });
  });

  it("does not turn misses or non-targeted props into commands", () => {
    const snapshot = createMatch("prop-miss", 8, 0);
    expect(activePropDropTargetAt(snapshot, 0, 3, cellCenter(67))).toBeNull();
    expect(activePropDropTargetAt(snapshot, 0, 5, cellCenter(48))).toBeNull();
  });

  it("maps a resolved drop to the existing authoritative USE_PROP command", () => {
    expect(commandForActivePropDrop({ propId: 10, targetUnitId: "own-2" }))
      .toEqual({ type: "USE_PROP", propId: 10, targetUnitId: "own-2" });
    expect(commandForActivePropDrop({ propId: 9, targetCell: 55 }))
      .toEqual({ type: "USE_PROP", propId: 9, targetCell: 55 });
  });
});

describe("in-match buff dragging", () => {
  it("targets only a live monster on the mirrored opponent route", () => {
    const snapshot = createMatch("buff-drag", 12, 0);
    snapshot.players[0].enemies.push({
      id: "own-monster", hp: 10, maxHp: 10, progress: 0, boss: false, stunnedMs: 0,
      pathX: 0, pathY: 9, pathIndex: 1,
    });
    snapshot.players[1].enemies.push({
      id: "opponent-monster", hp: 10, maxHp: 10, progress: 0, boss: false, stunnedMs: 0,
      pathX: 0, pathY: 9, pathIndex: 1,
    });
    const mirroredOpponentPoint = {
      x: (GAME_CONFIG.columns - 1 - 0 + 0.5) * GAME_CONFIG.cellSize,
      y: GAME_CONFIG.mapTop + (GAME_CONFIG.rows - 1 - 9 + 0.5) * GAME_CONFIG.cellSize,
    };
    expect(battleBuffDropTargetAt(snapshot, 0, "buff-1", "haste", mirroredOpponentPoint)).toEqual({
      buffInstanceId: "buff-1", buffKind: "haste", targetEnemyId: "opponent-monster",
    });
    expect(battleBuffDropTargetAt(snapshot, 0, "buff-1", "haste", { x: 40, y: 960 })).toBeNull();
  });

  it("maps the visual drop to the authoritative buff command", () => {
    expect(commandForBattleBuffDrop({ buffInstanceId: "buff-2", buffKind: "rally", targetEnemyId: "enemy-9" }))
      .toEqual({ type: "USE_BATTLE_BUFF", buffInstanceId: "buff-2", targetEnemyId: "enemy-9" });
  });
});
