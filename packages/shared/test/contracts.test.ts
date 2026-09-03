import { describe, expect, it } from "vitest";
import {
  applyCommand, attackRangeIntersectsCell, cellIndex, cloneSnapshot, createMatch, executeCommand,
  initialOpenCells, MATCH_SNAPSHOT_VERSION, normalizeMatchSnapshot, SOLDIERS, stepMatch,
  type CommandEnvelope, type MatchSnapshot, type MatchSnapshotInput, type PlayerBattleState, type UnitState,
} from "../src";

function unit(id: string, kind: string, level: number, cell: number): UnitState {
  return { id, kind, level, cell, cooldownMs: 0, attackCount: 0 };
}

function occupiedBoardCells(player: PlayerBattleState) {
  return player.units.flatMap((candidate) => candidate.secondaryCell === undefined
    ? [candidate.cell]
    : [candidate.cell, candidate.secondaryCell]);
}

function occupiedReserveSlots(player: PlayerBattleState) {
  return player.reserve.flatMap((candidate) => candidate.secondarySlot === undefined
    ? [candidate.slot]
    : [candidate.slot, candidate.secondarySlot]);
}

function expectUnique(values: number[]) {
  expect(new Set(values).size).toBe(values.length);
}

function envelope(snapshot: MatchSnapshot, commandId: string, clientSeq: number, command: CommandEnvelope["command"]): CommandEnvelope {
  return { commandId, clientSeq, expectedStateVersion: snapshot.stateVersion, command };
}

describe("authoritative command contract", () => {
  it("applies an envelope once and returns the accepted result for an identical retry", () => {
    const match = createMatch("IDEMPOTENT", 101);
    const command = envelope(match, "p0-1", 1, { type: "RECRUIT" });

    const first = executeCommand(match, 0, command);
    expect(first).toEqual({ commandId: "p0-1", ok: true, duplicate: false, stateVersion: 1 });
    const afterFirst = cloneSnapshot(match);

    const retry = executeCommand(match, 0, command);
    expect(retry).toEqual({ commandId: "p0-1", ok: true, duplicate: true, stateVersion: 1 });
    expect(match).toEqual(afterFirst);
    expect(match.players[0].recruitCount).toBe(1);
  });

  it("rejects command-id conflicts, future versions, and decreasing client sequences without mutation", () => {
    const match = createMatch("ENVELOPE-ERRORS", 102);
    const accepted = envelope(match, "p0-1", 1, { type: "RECRUIT" });
    expect(executeCommand(match, 0, accepted).ok).toBe(true);

    let before = cloneSnapshot(match);
    const conflict = executeCommand(match, 0, { ...accepted, command: { type: "CLAIM_SHOVEL_SUPPLY" } });
    expect(conflict).toMatchObject({ ok: false, code: "ERR_COMMAND_ID_CONFLICT" });
    expect(match).toEqual(before);

    before = cloneSnapshot(match);
    const future = executeCommand(match, 0, {
      commandId: "p0-2", clientSeq: 2, expectedStateVersion: match.stateVersion + 1, command: { type: "RECRUIT" },
    });
    expect(future).toMatchObject({ ok: false, code: "ERR_STATE_VERSION" });
    expect(match).toEqual(before);

    before = cloneSnapshot(match);
    const decreasing = executeCommand(match, 0, envelope(match, "p0-old", 1, { type: "RECRUIT" }));
    expect(decreasing).toMatchObject({ ok: false, code: "ERR_CLIENT_SEQUENCE" });
    expect(match).toEqual(before);
  });

  it("accepts a lagged snapshot version after battle ticks and validates against current state", () => {
    const match = createMatch("LAGGED", 114);
    stepMatch(match, 100);
    expect(match.stateVersion).toBe(1);

    const result = executeCommand(match, 0, {
      commandId: "p0-1", clientSeq: 1, expectedStateVersion: 0, command: { type: "RECRUIT" },
    });
    expect(result).toEqual({ commandId: "p0-1", ok: true, duplicate: false, stateVersion: 2 });
  });

  it("rejects malformed runtime payloads without consuming their sequence", () => {
    const match = createMatch("MALFORMED", 103);
    const malformed = {
      commandId: "p0-1", clientSeq: 1, expectedStateVersion: 0,
      command: { type: "SPLIT_GENERAL", unitId: "general", partIndex: 3, targetCell: 58 },
    } as unknown as CommandEnvelope;
    const before = cloneSnapshot(match);
    expect(executeCommand(match, 0, malformed)).toMatchObject({ ok: false, code: "ERR_INVALID_ENVELOPE" });
    expect(match).toEqual(before);

    expect(executeCommand(match, 0, envelope(match, "p0-2", 1, { type: "RECRUIT" })).ok).toBe(true);
  });

  it("does not leak partial mutations or clear prior events when a command is rejected", () => {
    const match = createMatch("ATOMIC", 104);
    match.players[0].units = [
      unit("source", "刀", 5, cellIndex(2, 7)),
      unit("target", "刀", 5, cellIndex(4, 7)),
    ];
    expect(applyCommand(match, 0, { type: "MOVE", unitId: "source", targetCell: cellIndex(3, 7) }).ok).toBe(true);
    expect(match.events[0]).toMatchObject({ type: "unit-moved" });
    const before = cloneSnapshot(match);

    const result = applyCommand(match, 0, { type: "MERGE", sourceId: "source", targetId: "target" });
    expect(result).toMatchObject({ ok: false, code: "ERR_INVALID_COMMAND" });
    expect(match).toEqual(before);
  });
});

describe("deterministic snapshot and event contracts", () => {
  it("publishes the canonical numeric snapshot schema version", () => {
    const match = createMatch("VERSIONED", 124);
    expect(match.version).toBe(MATCH_SNAPSHOT_VERSION);
    expect(match.version).toBeTypeOf("number");
    expect(match.snapshotVersion).toBe(match.version);
  });

  it("creates byte-for-byte equivalent logical snapshots and replays the same inputs deterministically", () => {
    const a = createMatch("DETERMINISTIC", 0xC0FFEE, 2);
    const b = createMatch("DETERMINISTIC", 0xC0FFEE, 2);
    expect(a).toEqual(b);
    expect(a.serverTime).toBe(0);
    expect(a.simulationTimeMs).toBe(0);

    const command = envelope(a, "p0-1", 1, { type: "RECRUIT" });
    expect(executeCommand(a, 0, command)).toEqual(executeCommand(b, 0, structuredClone(command)));
    for (let tick = 0; tick < 25; tick += 1) {
      stepMatch(a, 100);
      stepMatch(b, 100);
    }
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("publishes only the latest transition while keeping event IDs monotonic after cloning", () => {
    const match = createMatch("EVENTS", 105);
    match.players[0].reserve = [{ id: "r-blade", kind: "刀", level: 1, slot: 0 }];
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "r-blade", targetCell: cellIndex(2, 7) }).ok).toBe(true);
    expect(match.events).toEqual([
      expect.objectContaining({ id: "event-1", type: "unit-deployed", tick: 0, stateVersion: 1, cells: [cellIndex(2, 7)] }),
    ]);

    const restored = cloneSnapshot(match);
    expect(applyCommand(restored, 0, { type: "MOVE", unitId: "u-blade", targetCell: cellIndex(3, 7) }).ok).toBe(true);
    expect(restored.events).toEqual([
      expect.objectContaining({ id: "event-2", type: "unit-moved", stateVersion: 2 }),
    ]);
    expect(restored.eventSequence).toBe(2);
    expect(restored.combatEvents).toEqual([]);
  });

  it("mirrors attack events into the legacy combat view with the same stable ID", () => {
    const match = createMatch("ATTACK-EVENT", 106);
    const player = match.players[0];
    player.phase = "battle";
    player.prepareMs = 0;
    player.spawnMs = 999_999;
    player.remainingToSpawn = 1;
    player.units = [unit("blade", "刀", 1, cellIndex(2, 7))];
    player.enemies = [{ id: "target", hp: 20, maxHp: 20, progress: 5 / 17, boss: false, stunnedMs: 0 }];

    stepMatch(match, 100);
    expect(match.events).toHaveLength(1);
    expect(match.events[0]).toMatchObject({ id: "event-1", type: "attack", stateVersion: 1, damage: 3 });
    expect(match.combatEvents).toEqual(match.events);
  });

  it("rejects invalid simulation deltas before changing the snapshot", () => {
    for (const delta of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const match = createMatch("BAD-DELTA", 107);
      const before = cloneSnapshot(match);
      expect(() => stepMatch(match, delta)).toThrow(RangeError);
      expect(match).toEqual(before);
    }
  });

  it("refuses to continue an unsupported future snapshot version", () => {
    const match = createMatch("FUTURE-SNAPSHOT", 115);
    (match as unknown as { snapshotVersion: number }).snapshotVersion = 2;
    expect(() => stepMatch(match, 100)).toThrow(/不支持的快照版本/);
  });

  it("hydrates deterministic metadata when reading a 0.x snapshot", () => {
    const legacy = createMatch("LEGACY", 116) as MatchSnapshotInput;
    delete legacy.version;
    delete legacy.snapshotVersion;
    delete legacy.simulationTimeMs;
    delete legacy.events;
    delete legacy.eventSequence;
    delete legacy.acceptedCommands;
    delete legacy.lastClientSeq;
    legacy.serverTime = 250;

    const restored = cloneSnapshot(legacy as MatchSnapshot);
    expect(restored).toMatchObject({
      version: 1, snapshotVersion: 1, simulationTimeMs: 250, serverTime: 250,
      events: [], eventSequence: 0, acceptedCommands: {}, lastClientSeq: [0, 0],
    });
  });

  it("normalizes snapshots carrying only the legacy or canonical version field", () => {
    const legacyAliasOnly = createMatch("LEGACY-ALIAS", 125) as MatchSnapshotInput;
    delete legacyAliasOnly.version;
    expect(normalizeMatchSnapshot(legacyAliasOnly)).toMatchObject({
      version: 1, snapshotVersion: 1,
    });

    const canonicalOnly = createMatch("CANONICAL-ONLY", 126) as MatchSnapshotInput;
    delete canonicalOnly.snapshotVersion;
    expect(normalizeMatchSnapshot(canonicalOnly)).toMatchObject({
      version: 1, snapshotVersion: 1,
    });
  });

  it("rejects conflicting or unsupported snapshot version fields", () => {
    const conflict = createMatch("VERSION-CONFLICT", 127);
    (conflict as unknown as { snapshotVersion: number }).snapshotVersion = 2;
    expect(() => normalizeMatchSnapshot(conflict)).toThrow(/不支持的快照版本|快照版本字段冲突/);

    const future = createMatch("VERSION-FUTURE", 128);
    (future as unknown as { version: number }).version = 2;
    delete (future as unknown as { snapshotVersion?: number }).snapshotVersion;
    expect(() => normalizeMatchSnapshot(future)).toThrow(/不支持的快照版本/);
  });
});

describe("board, camp, merge, range, and prop regressions", () => {
  it("rejects movement outside unlocked own cells without changing occupancy", () => {
    const invalidTargets = [-1, 80, 1.5, cellIndex(0, 9), cellIndex(1, 7), cellIndex(2, 2)];
    for (const targetCell of invalidTargets) {
      const match = createMatch("MOVE-BOUNDARY", 108);
      match.players[0].units = [unit("blade", "刀", 1, cellIndex(2, 7))];
      const before = cloneSnapshot(match);
      expect(applyCommand(match, 0, { type: "MOVE", unitId: "blade", targetCell }).ok).toBe(false);
      expect(match).toEqual(before);
    }
  });

  it("requires two free adjacent board cells for a general and never overlaps occupants", () => {
    const match = createMatch("GENERAL-OCCUPANCY", 109);
    const player = match.players[0];
    const targetCell = cellIndex(3, 7);
    player.reserve = [{ id: "r-general", kind: "赵云", level: 1, slot: 0, secondarySlot: 1, parts: ["赵", "云"] }];
    player.units = [
      unit("left", "刀", 1, cellIndex(2, 7)),
      unit("right", "弓", 1, cellIndex(4, 7)),
      unit("below", "枪", 1, cellIndex(3, 8)),
    ];
    const before = cloneSnapshot(match);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "r-general", targetCell }).ok).toBe(false);
    expect(match).toEqual(before);

    player.units = player.units.filter((candidate) => candidate.id !== "right");
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "r-general", targetCell }).ok).toBe(true);
    expectUnique(occupiedBoardCells(player));
    const general = player.units.find((candidate) => candidate.kind === "赵云");
    expect(general && occupiedBoardCells({ ...player, units: [general] })).toHaveLength(2);
  });

  it("keeps a two-slot general adjacent and collision-free when it moves in camp", () => {
    const match = createMatch("CAMP-OCCUPANCY", 110);
    const player = match.players[0];
    player.reserve = [
      { id: "general", kind: "赵云", level: 1, slot: 0, secondarySlot: 1, parts: ["赵", "云"] },
      { id: "left-blocker", kind: "刀", level: 1, slot: 2 },
      { id: "right-blocker", kind: "弓", level: 1, slot: 4 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_RESERVE_TO_SLOT", reserveId: "general", targetSlot: 3 }).ok).toBe(false);
    expect(player.reserve.find((candidate) => candidate.id === "general")).toMatchObject({ slot: 0, secondarySlot: 1 });

    player.reserve = player.reserve.filter((candidate) => candidate.id !== "right-blocker");
    expect(applyCommand(match, 0, { type: "DROP_RESERVE_TO_SLOT", reserveId: "general", targetSlot: 3 }).ok).toBe(true);
    const general = player.reserve[0]!;
    expect(Math.abs(general.slot - general.secondarySlot!)).toBe(1);
    expectUnique(occupiedReserveSlots(player));
  });

  it("upgrades identical units exactly once and rejects merges above the configured maximum", () => {
    const match = createMatch("MERGE-MAX", 111);
    const player = match.players[0];
    player.units = [unit("source", "刀", 4, cellIndex(2, 7)), unit("target", "刀", 4, cellIndex(3, 7))];
    expect(applyCommand(match, 0, { type: "MERGE", sourceId: "source", targetId: "target" }).ok).toBe(true);
    expect(player.units).toEqual([expect.objectContaining({ id: "target", level: 5 })]);
    expect(match.events[0]).toMatchObject({ type: "units-merged", resultLevel: 5, location: "board" });

    player.units.push(unit("source-max", "刀", 5, cellIndex(2, 7)));
    const before = cloneSnapshot(match);
    expect(applyCommand(match, 0, { type: "MERGE", sourceId: "source-max", targetId: "target" }).ok).toBe(false);
    expect(match).toEqual(before);
  });

  it("treats full coverage and exact edge contact as hits, but not a gap beyond the edge", () => {
    expect(attackRangeIntersectsCell({ x: 0, y: 0 }, { x: 0, y: 0 }, 2)).toBe(true);
    expect(attackRangeIntersectsCell({ x: 0, y: 0 }, { x: 2.4875, y: 0 }, 2)).toBe(true);
    expect(attackRangeIntersectsCell({ x: 0, y: 0 }, { x: 2.487_501, y: 0 }, 2)).toBe(false);
  });

  it("uses every soldier's configured range in the shared full-cell collision rule", () => {
    for (const config of Object.values(SOLDIERS)) {
      const edgeCenter = config.range - 1 / 80 + 0.5;
      expect(attackRangeIntersectsCell({ x: 0, y: 0 }, { x: edgeCenter, y: 0 }, config.range)).toBe(true);
      expect(attackRangeIntersectsCell({ x: 0, y: 0 }, { x: edgeCenter + 0.000_001, y: 0 }, config.range)).toBe(false);
    }
  });

  it("fires each level-one soldier exactly at its configured attack interval", () => {
    for (const [kind, config] of Object.entries(SOLDIERS)) {
      const match = createMatch(`INTERVAL-${kind}`, 117);
      const player = match.players[0];
      player.phase = "battle";
      player.spawnMs = 999_999;
      player.remainingToSpawn = 1;
      player.units = [{ ...unit("attacker", kind, 1, cellIndex(2, 7)), cooldownMs: config.intervalMs }];
      player.enemies = [{ id: "target", hp: 1_000, maxHp: 1_000, progress: 5 / 17, boss: false, stunnedMs: 0 }];

      const steps = config.intervalMs / 100;
      for (let index = 1; index < steps; index += 1) stepMatch(match, 100);
      expect(player.units[0]?.attackCount).toBe(0);
      stepMatch(match, 100);
      expect(player.units[0]?.attackCount).toBe(1);
    }
  });

  it("does not accumulate attack debt while enemies remain outside every soldier's range", () => {
    for (const kind of Object.keys(SOLDIERS)) {
      const match = createMatch(`NO-ATTACK-DEBT-${kind}`, 121);
      const player = match.players[0];
      player.phase = "battle";
      player.spawnMs = 999_999;
      player.remainingToSpawn = 1;
      player.units = [unit("attacker", kind, 1, cellIndex(4, 7))];
      player.enemies = [{ id: "waiting", hp: 1_000, maxHp: 1_000, progress: 0, boss: false, stunnedMs: 100_000 }];

      for (let index = 0; index < 50; index += 1) stepMatch(match, 100);
      expect(player.units[0]).toMatchObject({ cooldownMs: 0, attackCount: 0 });

      player.enemies[0]!.progress = 7 / 17;
      stepMatch(match, 100);
      expect(player.units[0]?.attackCount).toBe(1);
      stepMatch(match, 100);
      expect(player.units[0]?.attackCount).toBe(1);
    }
  });

  it("self-heals negative cooldowns restored from affected snapshots without burst attacks", () => {
    const match = createMatch("NEGATIVE-COOLDOWN", 122);
    const player = match.players[0];
    player.phase = "battle";
    player.spawnMs = 999_999;
    player.remainingToSpawn = 1;
    player.units = [{ ...unit("spear", "枪", 1, cellIndex(2, 7)), cooldownMs: -5_000 }];
    player.enemies = [{ id: "target", hp: 1_000, maxHp: 1_000, progress: 5 / 17, boss: false, stunnedMs: 0 }];

    stepMatch(match, 100);
    expect(player.units[0]).toMatchObject({ attackCount: 1, cooldownMs: 700 });
    stepMatch(match, 100);
    expect(player.units[0]?.attackCount).toBe(1);
  });

  it("does not let later units attack a target already killed in the same tick", () => {
    const match = createMatch("NO-OVERKILL", 123);
    const player = match.players[0];
    player.phase = "battle";
    player.spawnMs = 999_999;
    player.remainingToSpawn = 1;
    player.units = [2, 3, 4].map((x, index) => unit(`spear-${index}`, "枪", 1, cellIndex(x, 7)));
    player.enemies = [{ id: "one-hp", hp: 1, maxHp: 1, progress: 5 / 17, boss: false, stunnedMs: 0 }];

    stepMatch(match, 100);
    expect(player.units.map((candidate) => candidate.attackCount)).toEqual([1, 0, 0]);
    expect(match.combatEvents).toEqual([
      expect.objectContaining({ unitId: "spear-0", targetId: "one-hp" }),
    ]);
    expect(player.enemies).toEqual([]);
  });

  it("emits prop use and rejects using the trash can on a shovel atomically", () => {
    const match = createMatch("PROP-CONTRACT", 112);
    const player = match.players[0];
    player.units = [unit("blade", "刀", 1, cellIndex(2, 7))];
    player.reserve = [{ id: "shovel", kind: "铲子", level: 1, slot: 0 }];
    expect(applyCommand(match, 0, {
      type: "SET_PROP_LOADOUT", loadout: { active: [3, 21], passive: [] },
    }).ok).toBe(true);
    expect(applyCommand(match, 0, { type: "USE_PROP", propId: 3, targetUnitId: "blade" }).ok).toBe(true);
    expect(match.events).toEqual([expect.objectContaining({ type: "prop-used", propId: 3, targetUnitId: "blade" })]);

    const before = cloneSnapshot(match);
    expect(applyCommand(match, 0, { type: "USE_PROP", propId: 21, reserveId: "shovel" }).ok).toBe(false);
    expect(match).toEqual(before);
  });

  it("rejects duplicate prop loadout entries instead of silently normalizing them", () => {
    const match = createMatch("DUPLICATE-PROPS", 120);
    const before = cloneSnapshot(match);
    expect(applyCommand(match, 0, {
      type: "SET_PROP_LOADOUT", loadout: { active: [3, 3], passive: [] },
    })).toMatchObject({ ok: false, code: "ERR_INVALID_COMMAND" });
    expect(match).toEqual(before);
  });

  it("emits an authoritative unlock event only for an adjacent own grass cell", () => {
    const match = createMatch("SHOVEL-EVENT", 113);
    const player = match.players[0];
    player.reserve = [{ id: "shovel", kind: "铲子", level: 1, slot: 0 }];
    const grass = cellIndex(1, 7);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "shovel", targetCell: grass }).ok).toBe(true);
    expect(match.events).toEqual([
      expect.objectContaining({ type: "cell-unlocked", cell: grass, sourceReserveId: "shovel" }),
    ]);
    expect(player.unlockedCells).toContain(grass);
    expectUnique(player.unlockedCells);
    expect(initialOpenCells(match.mapIndex)).not.toContain(grass);
  });

  it("emits enemy defeat, player damage, and match result as already-settled facts", () => {
    const killMatch = createMatch("DEFEAT-EVENT", 118);
    const attacker = killMatch.players[0];
    attacker.phase = "battle";
    attacker.spawnMs = 999_999;
    attacker.remainingToSpawn = 1;
    attacker.units = [unit("blade", "刀", 1, cellIndex(2, 7))];
    attacker.enemies = [{ id: "doomed", hp: 1, maxHp: 1, progress: 5 / 17, boss: false, stunnedMs: 0 }];
    stepMatch(killMatch, 100);
    expect(killMatch.events.map((event) => event.type)).toEqual(["attack", "enemy-defeated"]);
    expect(killMatch.events[1]).toMatchObject({ enemyId: "doomed", rewardBuns: 1 });

    const lossMatch = createMatch("RESULT-EVENT", 119);
    const defender = lossMatch.players[0];
    defender.phase = "battle";
    defender.hp = 1;
    defender.spawnMs = 999_999;
    defender.remainingToSpawn = 1;
    defender.enemies = [{ id: "escaped", hp: 10, maxHp: 10, progress: 0.999, boss: false, stunnedMs: 0 }];
    stepMatch(lossMatch, 100);
    expect(lossMatch.events.map((event) => event.type)).toEqual(["player-damaged", "match-finished"]);
    expect(lossMatch.events[0]).toMatchObject({ remainingHp: 0, awardedBuns: 10 });
    expect(lossMatch.events[1]).toMatchObject({ winner: 1 });
  });
});
