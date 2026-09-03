import { describe, expect, it } from "vitest";
import { cellIndex, createMatch, type MatchSnapshot, type PlayerBattleState } from "@adou/shared";
import { stepMatchBatch } from "../src/net/stepMatchBatch";

function battleWithUnits(units: PlayerBattleState["units"]): MatchSnapshot {
  const snapshot = createMatch("CATCHUP", 18, 0);
  const player = snapshot.players[0];
  player.phase = "battle";
  player.prepareMs = 0;
  player.spawnMs = 999_999;
  player.remainingToSpawn = 1;
  player.units = units;
  player.enemies = [{
    id: "target",
    hp: 100,
    maxHp: 100,
    progress: 5 / 17,
    boss: false,
    stunnedMs: 0,
  }];
  return snapshot;
}

describe("realtime catch-up combat events", () => {
  it("keeps an attack from an earlier catch-up tick when the final tick has no attack", () => {
    const snapshot = battleWithUnits([
      { id: "first-tick", kind: "刀", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 },
    ]);
    const initialVersion = snapshot.stateVersion;

    stepMatchBatch(snapshot, 2, 100);

    expect(snapshot.stateVersion).toBe(initialVersion + 2);
    expect(snapshot.combatEvents).toHaveLength(1);
    expect(snapshot.combatEvents[0]).toMatchObject({ unitId: "first-tick", targetId: "target", tick: 1 });

    stepMatchBatch(snapshot, 1, 100);
    expect(snapshot.combatEvents).toEqual([]);
  });

  it("preserves event order and unique IDs when consecutive catch-up ticks both attack", () => {
    const snapshot = battleWithUnits([
      { id: "first-tick", kind: "刀", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 },
      { id: "second-tick", kind: "刀", level: 1, cell: cellIndex(2, 7), cooldownMs: 150, attackCount: 0 },
    ]);

    stepMatchBatch(snapshot, 2, 100);

    expect(snapshot.combatEvents.map((event) => ({ id: event.id, tick: event.tick, unitId: event.unitId })))
      .toEqual([
        { id: "event-1", tick: 1, unitId: "first-tick" },
        { id: "event-2", tick: 2, unitId: "second-tick" },
      ]);
    expect(new Set(snapshot.combatEvents.map((event) => event.id)).size).toBe(2);
  });
});
