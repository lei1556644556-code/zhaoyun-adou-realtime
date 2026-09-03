import { describe, expect, it } from "vitest";
import {
  BATTLE_INPUT,
  BATTLE_LAYOUT,
  battleDropTargetAt,
  commandForBattleCampDrop,
  commandForBattleDrop,
  createPointerGesture,
  isTapGesture,
  updatePointerGesture,
  worldDragThreshold,
} from "../src/game/battleInteraction";

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
