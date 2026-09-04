import { describe, expect, it } from "vitest";
import {
  BATTLE_BUFFS, BOSS_CONFIGS, GAME_CONFIG, GENERAL_SKILLS, INTRO_ROUND_HP_MULTIPLIERS, MAP_LAYOUTS, NORMAL_ENEMY_SPEED_PX_PER_SEC,
  PROPS, TOKEN_POOL, applyCommand, attackRangeIntersectsCell, cellCode, cellIndex, createMatch, createRng, executeCommand,
  initialOpenCells, normalizeMatchSnapshot, pathLengthCells, pathPoint, stepMatch, type CommandEnvelope, type MatchSnapshot,
} from "../src";

function bossFixture(bossType: number, withSoldier = false): MatchSnapshot {
  const match = createMatch(`BOSS-SKILL-${bossType}`, 10_900 + bossType);
  const player = match.players[0];
  player.phase = "battle";
  player.prepareMs = 0;
  player.spawnMs = 999_999;
  player.remainingToSpawn = 1;
  player.units = withSoldier ? [{
    id: `soldier-${bossType}`, kind: "刀", level: 2, cell: cellIndex(4, 7), cooldownMs: 999_999, attackCount: 0,
  }] : [];
  player.enemies = [{
    id: `boss-${bossType}`, hp: 10_000, maxHp: 10_000, progress: 0.4,
    boss: true, bossType, stunnedMs: 0, pathX: 4, pathY: 6, pathIndex: 7,
    bossCooldownMs: BOSS_CONFIGS[bossType]!.cooldownMs, scaleMultiplier: 1,
  }];
  return match;
}

function expandedTestPath(mapIndex: number) {
  const source = MAP_LAYOUTS[mapIndex]!.path;
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

function generalSkillFixture(kind: string, attackCount: number, hp = 10_000) {
  const match = createMatch(`GENERAL-${kind}`, 8_109);
  const player = match.players[0];
  player.phase = "battle"; player.prepareMs = 0; player.spawnMs = 999_999; player.remainingToSpawn = 1;
  player.units = [{
    id: `general-${kind}`, kind, level: 1, cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7),
    cooldownMs: 0, attackCount,
  }];
  player.enemies = [{
    id: "target", hp, maxHp: hp, progress: 0.4, boss: false, stunnedMs: 0,
    pathX: 4, pathY: 6, pathIndex: 7,
  }];
  return match;
}

describe("1.0.9 authoritative simulation", () => {
  it("migrates 1.4.0 in-progress saves to the additive 1.5.0 skill runtime without clearing play", () => {
    const previous = createMatch("PREVIOUS-SCHEMA", 109) as unknown as Record<string, unknown>;
    previous.rulesConfigSchemaVersion = "1.4.0";
    const migrated = normalizeMatchSnapshot(previous as unknown as MatchSnapshot);
    expect(migrated.rulesConfigSchemaVersion).toBe("1.5.0");
    expect(migrated.players[0].pendingGeneralImpacts).toEqual([]);
    expect(migrated.players[0].zhaoPhantoms).toEqual([]);
  });

  it("uses the package-backed board and opening values", () => {
    const match = createMatch("TEST", 1234);
    expect(GAME_CONFIG.columns).toBe(8);
    expect(GAME_CONFIG.rows).toBe(10);
    expect(match.mapIndex).toBe(0);
    expect(match.players[0].hp).toBe(3);
    expect(match.players[0].buns).toBe(20);
    expect(match.players[0].recruitCost).toBe(10);
    expect(match.players[0].unlockedCells).toEqual([
      cellIndex(2, 7), cellIndex(3, 7), cellIndex(4, 7),
      cellIndex(2, 8), cellIndex(3, 8), cellIndex(4, 8),
    ]);
  });

  it("recruits five reserve pieces and advances price 10 to 12", () => {
    const match = createMatch("TEST", 8);
    const result = applyCommand(match, 0, { type: "RECRUIT" });
    expect(result.ok).toBe(true);
    expect(match.players[0].buns).toBe(10);
    expect(match.players[0].recruitCost).toBe(12);
    expect(match.players[0].reserve).toHaveLength(5);
    expect(match.players[0].units).toHaveLength(0);
  });

  it("drags a camp piece onto an open cell", () => {
    const match = createMatch("TEST", 9);
    match.players[0].reserve = [{ id: "reserve", kind: "刀", level: 1, slot: 0 }];
    const targetCell = cellIndex(2, 7);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "reserve", targetCell }).ok).toBe(true);
    expect(match.players[0].reserve).toHaveLength(0);
    expect(match.players[0].units[0]).toMatchObject({ kind: "刀", level: 1, cell: targetCell });
  });

  it("merges identical soldiers by dragging on the target", () => {
    const match = createMatch("TEST", 10);
    match.players[0].units = [
      { id: "a", kind: "刀", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 },
      { id: "b", kind: "刀", level: 1, cell: cellIndex(3, 7), cooldownMs: 0, attackCount: 0 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_UNIT", unitId: "a", targetCell: cellIndex(3, 7) }).ok).toBe(true);
    expect(match.players[0].units).toEqual([
      { id: "b", kind: "刀", level: 2, cell: cellIndex(3, 7), cooldownMs: 0, attackCount: 0 },
    ]);
  });

  it("combines two name characters into a general", () => {
    const match = createMatch("TEST", 11);
    match.players[0].units = [
      { id: "zhao", kind: "赵", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 },
      { id: "yun", kind: "云", level: 1, cell: cellIndex(3, 7), cooldownMs: 0, attackCount: 0 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_UNIT", unitId: "zhao", targetCell: cellIndex(3, 7) }).ok).toBe(true);
    expect(match.players[0].units).toEqual([{
      id: "yun", kind: "赵云", level: 1,
      cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7), parts: ["赵", "云"],
      cooldownMs: 0, attackCount: 0,
    }]);
  });

  it("automatically combines name characters placed in horizontal neighboring cells", () => {
    const match = createMatch("AUTO-GENERAL", 111);
    const firstCell = cellIndex(2, 7);
    const secondCell = cellIndex(3, 7);
    match.players[0].units = [
      { id: "zhao", kind: "赵", level: 1, cell: firstCell, cooldownMs: 0, attackCount: 0 },
    ];
    match.players[0].reserve = [{ id: "r-yun", kind: "云", level: 1, slot: 0 }];

    const command: CommandEnvelope = {
      commandId: "auto-deploy-1", clientSeq: 1, expectedStateVersion: match.stateVersion,
      command: { type: "DROP_RESERVE", reserveId: "r-yun", targetCell: secondCell },
    };
    const versionBefore = match.stateVersion;
    expect(executeCommand(match, 0, command)).toEqual({
      commandId: command.commandId, ok: true, duplicate: false, stateVersion: versionBefore + 1,
    });
    expect(match.stateVersion).toBe(versionBefore + 1);
    expect(match.events.map((event) => event.type)).toEqual(["unit-deployed", "units-merged"]);
    expect(match.events.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(match.events.every((event) => event.stateVersion === match.stateVersion)).toBe(true);
    expect(match.players[0].units).toEqual([{
      id: "zhao", kind: "赵云", level: 1,
      cell: firstCell, secondaryCell: secondCell, parts: ["赵", "云"],
      cooldownMs: 0, attackCount: 0,
    }]);

    const eventsAfterFirstAttempt = structuredClone(match.events);
    const eventSequenceAfterFirstAttempt = match.eventSequence;
    expect(executeCommand(match, 0, structuredClone(command))).toEqual({
      commandId: command.commandId, ok: true, duplicate: true, stateVersion: versionBefore + 1,
    });
    expect(match.stateVersion).toBe(versionBefore + 1);
    expect(match.eventSequence).toBe(eventSequenceAfterFirstAttempt);
    expect(match.events).toEqual(eventsAfterFirstAttempt);
  });

  it("automatically combines after moving a board character beside its partner", () => {
    const match = createMatch("MOVE-AUTO-GENERAL", 112);
    const firstCell = cellIndex(2, 7);
    const secondCell = cellIndex(3, 7);
    match.players[0].units = [
      { id: "zhao", kind: "赵", level: 1, cell: firstCell, cooldownMs: 0, attackCount: 0 },
      { id: "yun", kind: "云", level: 1, cell: cellIndex(4, 7), cooldownMs: 0, attackCount: 0 },
    ];

    expect(applyCommand(match, 0, { type: "DROP_UNIT", unitId: "yun", targetCell: secondCell }).ok).toBe(true);
    expect(match.players[0].units).toEqual([expect.objectContaining({
      kind: "赵云", cell: firstCell, secondaryCell: secondCell, parts: ["赵", "云"],
    })]);
  });

  it("appends an automatic merge after a board swap without a second version increment", () => {
    const match = createMatch("SWAP-AUTO-GENERAL", 115);
    const leftCell = cellIndex(2, 7);
    const targetCell = cellIndex(3, 7);
    const sourceCell = cellIndex(4, 7);
    match.players[0].units = [
      { id: "yun", kind: "云", level: 1, cell: leftCell, cooldownMs: 0, attackCount: 0 },
      { id: "blade", kind: "刀", level: 1, cell: targetCell, cooldownMs: 0, attackCount: 0 },
      { id: "zhao", kind: "赵", level: 1, cell: sourceCell, cooldownMs: 0, attackCount: 0 },
    ];

    const versionBefore = match.stateVersion;
    expect(applyCommand(match, 0, { type: "DROP_UNIT", unitId: "zhao", targetCell }).ok).toBe(true);
    expect(match.stateVersion).toBe(versionBefore + 1);
    expect(match.events.map((event) => event.type)).toEqual(["units-swapped", "units-merged"]);
    expect(match.events.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(match.events.every((event) => event.stateVersion === match.stateVersion)).toBe(true);
    expect(match.players[0].units).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "yun", kind: "赵云", cell: leftCell, secondaryCell: targetCell }),
      expect.objectContaining({ id: "blade", kind: "刀", cell: sourceCell }),
    ]));
  });

  it("does not combine name characters that are only vertically adjacent", () => {
    const match = createMatch("VERTICAL-NAMES", 113);
    match.players[0].units = [
      { id: "zhao", kind: "赵", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 },
    ];
    match.players[0].reserve = [{ id: "r-yun", kind: "云", level: 1, slot: 0 }];

    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "r-yun", targetCell: cellIndex(2, 8) }).ok).toBe(true);
    expect(match.players[0].units).toHaveLength(2);
    expect(match.players[0].units.every((unit) => unit.secondaryCell === undefined)).toBe(true);
  });

  it("chooses the left valid partner when both horizontal neighbors match", () => {
    const match = createMatch("DETERMINISTIC-GENERAL", 114);
    match.players[0].units = [
      { id: "left-yun", kind: "云", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 },
      { id: "right-yun", kind: "云", level: 1, cell: cellIndex(4, 7), cooldownMs: 0, attackCount: 0 },
      { id: "zhao", kind: "赵", level: 1, cell: cellIndex(3, 8), cooldownMs: 0, attackCount: 0 },
    ];

    expect(applyCommand(match, 0, { type: "DROP_UNIT", unitId: "zhao", targetCell: cellIndex(3, 7) }).ok).toBe(true);
    expect(match.players[0].units).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "left-yun", kind: "赵云", cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7) }),
      expect.objectContaining({ id: "right-yun", kind: "云", cell: cellIndex(4, 7) }),
    ]));
  });

  it("checks moved then stationary split parts and appends merges in that deterministic order", () => {
    const match = createMatch("SPLIT-AUTO-GENERALS", 116);
    const cells = [1, 2, 3, 4, 5].map((column) => cellIndex(column, 7));
    match.players[0].unlockedCells = cells;
    match.players[0].units = [
      { id: "left-yun", kind: "云", level: 1, cell: cells[0]!, cooldownMs: 0, attackCount: 0 },
      {
        id: "general", kind: "赵云", level: 1, cell: cells[1]!, secondaryCell: cells[2]!,
        parts: ["赵", "云"], cooldownMs: 0, attackCount: 0,
      },
      { id: "right-zhao", kind: "赵", level: 1, cell: cells[3]!, cooldownMs: 0, attackCount: 0 },
    ];

    const versionBefore = match.stateVersion;
    expect(applyCommand(match, 0, {
      type: "SPLIT_GENERAL", unitId: "general", partIndex: 1, targetCell: cells[4]!,
    }).ok).toBe(true);
    expect(match.stateVersion).toBe(versionBefore + 1);
    expect(match.events.map((event) => event.type)).toEqual([
      "general-split", "units-merged", "units-merged",
    ]);
    expect(match.events.map((event) => event.id)).toEqual(["event-1", "event-2", "event-3"]);
    expect(match.events.every((event) => event.stateVersion === match.stateVersion)).toBe(true);
    expect(match.events.slice(1)).toEqual([
      expect.objectContaining({
        type: "units-merged", sourceId: "general-split-1-1", targetId: "right-zhao", cells: [cells[3], cells[4]],
      }),
      expect.objectContaining({
        type: "units-merged", sourceId: "general-split-1-0", targetId: "left-yun", cells: [cells[0], cells[1]],
      }),
    ]);
  });

  it("keeps adjacent sibling characters split after dragging one part to an empty cell", () => {
    const match = createMatch("split-adjacent-regression", 109);
    const player = match.players[0];
    const left = cellIndex(2, 7);
    const right = cellIndex(3, 7);
    const adjacentTarget = cellIndex(4, 7);
    player.units = [{
      id: "general-zhaoyun", kind: "赵云", level: 2,
      cell: left, secondaryCell: right, parts: ["赵", "云"], cooldownMs: 0, attackCount: 0,
    }];

    expect(applyCommand(match, 0, {
      type: "SPLIT_GENERAL", unitId: "general-zhaoyun", partIndex: 0, targetCell: adjacentTarget,
    }).ok).toBe(true);

    expect(player.units).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "云", level: 2, cell: right }),
      expect.objectContaining({ kind: "赵", level: 2, cell: adjacentTarget }),
    ]));
    expect(player.units).toHaveLength(2);
    expect(match.events.map((event) => event.type)).toEqual(["general-split"]);
  });

  it("swaps same-level character parts between two fused generals", () => {
    const match = createMatch("general-part-swap", 109);
    const player = match.players[0];
    const zhao = cellIndex(2, 7);
    const yun = cellIndex(3, 7);
    const zhang = cellIndex(5, 7);
    const fei = cellIndex(6, 7);
    player.units = [
      {
        id: "general-zhaoyun", kind: "赵云", level: 2,
        cell: zhao, secondaryCell: yun, parts: ["赵", "云"], cooldownMs: 0, attackCount: 0,
      },
      {
        id: "general-zhangfei", kind: "张飞", level: 2,
        cell: zhang, secondaryCell: fei, parts: ["张", "飞"], cooldownMs: 0, attackCount: 0,
      },
    ];

    expect(applyCommand(match, 0, {
      type: "SPLIT_GENERAL", unitId: "general-zhangfei", partIndex: 0, targetCell: zhao,
    }).ok).toBe(true);

    expect(player.units).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "张", level: 2, cell: zhao }),
      expect.objectContaining({ kind: "云", level: 2, cell: yun }),
      expect.objectContaining({ kind: "赵", level: 2, cell: zhang }),
      expect.objectContaining({ kind: "飞", level: 2, cell: fei }),
    ]));
    expect(player.units).toHaveLength(4);
    expect(match.events.map((event) => event.type)).toEqual(["general-split", "general-split", "units-swapped"]);
  });

  it("keeps a fused general on two cells and can pull either character back out", () => {
    const match = createMatch("TEST", 14);
    const firstCell = cellIndex(2, 7);
    const secondCell = cellIndex(3, 7);
    const splitTarget = cellIndex(4, 8);
    match.players[0].units = [
      { id: "zhao", kind: "赵", level: 1, cell: firstCell, cooldownMs: 0, attackCount: 0 },
      { id: "yun", kind: "云", level: 1, cell: secondCell, cooldownMs: 0, attackCount: 0 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_UNIT", unitId: "zhao", targetCell: secondCell }).ok).toBe(true);
    const general = match.players[0].units[0]!;
    expect([general.cell, general.secondaryCell]).toEqual([firstCell, secondCell]);
    expect(applyCommand(match, 0, { type: "SPLIT_GENERAL", unitId: general.id, partIndex: 0, targetCell: splitTarget }).ok).toBe(true);
    expect(match.players[0].units).toHaveLength(2);
    expect(match.players[0].units).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "云", cell: secondCell }),
      expect.objectContaining({ kind: "赵", cell: splitTarget }),
    ]));
    expect(match.players[0].units.every((unit) => unit.secondaryCell === undefined)).toBe(true);
  });

  it("swaps a pulled general character directly with a single-cell soldier", () => {
    const match = createMatch("SPLIT-SWAP-SOLDIER", 117);
    const firstCell = cellIndex(2, 7);
    const secondCell = cellIndex(3, 7);
    const soldierCell = cellIndex(4, 7);
    match.players[0].units = [
      {
        id: "general", kind: "张飞", level: 2, cell: firstCell, secondaryCell: secondCell,
        parts: ["张", "飞"], cooldownMs: 0, attackCount: 0,
      },
      { id: "soldier", kind: "骑", level: 3, cell: soldierCell, cooldownMs: 0, attackCount: 0 },
    ];

    expect(applyCommand(match, 0, {
      type: "SPLIT_GENERAL", unitId: "general", partIndex: 0, targetCell: soldierCell,
    }).ok).toBe(true);
    expect(match.events.map((event) => event.type)).toEqual(["general-split", "units-swapped"]);
    expect(match.players[0].units).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "soldier", kind: "骑", level: 3, cell: firstCell }),
      expect.objectContaining({ kind: "飞", level: 2, cell: secondCell }),
      expect.objectContaining({ kind: "张", level: 2, cell: soldierCell }),
    ]));
  });

  it("moves and merges pieces inside the camp", () => {
    const match = createMatch("TEST", 15);
    match.players[0].reserve = [
      { id: "knife-a", kind: "刀", level: 1, slot: 0 },
      { id: "knife-b", kind: "刀", level: 1, slot: 3 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_RESERVE_TO_SLOT", reserveId: "knife-a", targetSlot: 1 }).ok).toBe(true);
    expect(match.players[0].reserve.find((item) => item.id === "knife-a")?.slot).toBe(1);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE_TO_SLOT", reserveId: "knife-a", targetSlot: 3 }).ok).toBe(true);
    expect(match.players[0].reserve).toEqual([{ id: "knife-b", kind: "刀", level: 2, slot: 3 }]);
  });

  it("combines a two-cell general in camp and deploys both cells together", () => {
    const match = createMatch("TEST", 16);
    match.players[0].reserve = [
      { id: "yun", kind: "云", level: 1, slot: 0 },
      { id: "zhao", kind: "赵", level: 1, slot: 4 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_RESERVE_TO_SLOT", reserveId: "zhao", targetSlot: 0 }).ok).toBe(true);
    expect(match.players[0].reserve).toEqual([{
      id: "yun", kind: "赵云", level: 1, slot: 0, secondarySlot: 1, parts: ["赵", "云"],
    }]);
    const firstCell = cellIndex(2, 7);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "yun", targetCell: firstCell }).ok).toBe(true);
    expect(match.players[0].units[0]).toMatchObject({
      kind: "赵云", cell: firstCell, secondaryCell: cellIndex(3, 7), parts: ["赵", "云"],
    });
  });

  it("returns a board soldier to camp and merges there", () => {
    const match = createMatch("TEST", 17);
    match.players[0].units = [{ id: "u-knife", kind: "刀", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 }];
    match.players[0].reserve = [{ id: "r-knife", kind: "刀", level: 1, slot: 2 }];
    expect(applyCommand(match, 0, { type: "DROP_UNIT_TO_RESERVE", unitId: "u-knife", targetSlot: 2 }).ok).toBe(true);
    expect(match.players[0].units).toHaveLength(0);
    expect(match.players[0].reserve).toEqual([{ id: "r-knife", kind: "刀", level: 2, slot: 2 }]);
  });

  it("swaps two incompatible board pieces instead of rejecting the drop", () => {
    const match = createMatch("TEST", 20);
    const firstCell = cellIndex(2, 7);
    const secondCell = cellIndex(3, 7);
    match.players[0].units = [
      { id: "blade", kind: "刀", level: 1, cell: firstCell, cooldownMs: 0, attackCount: 0 },
      { id: "spear", kind: "枪", level: 2, cell: secondCell, cooldownMs: 0, attackCount: 0 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_UNIT", unitId: "blade", targetCell: secondCell }).ok).toBe(true);
    expect(match.players[0].units).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "blade", cell: secondCell }),
      expect.objectContaining({ id: "spear", cell: firstCell }),
    ]));
  });

  it("swaps two incompatible camp pieces instead of rejecting the drop", () => {
    const match = createMatch("TEST", 21);
    match.players[0].reserve = [
      { id: "blade", kind: "刀", level: 1, slot: 0 },
      { id: "bow", kind: "弓", level: 2, slot: 4 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_RESERVE_TO_SLOT", reserveId: "blade", targetSlot: 4 }).ok).toBe(true);
    expect(match.players[0].reserve).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "blade", slot: 4 }),
      expect.objectContaining({ id: "bow", slot: 0 }),
    ]));
  });

  it("replaces a board piece with an incompatible camp piece in one drop", () => {
    const match = createMatch("TEST", 22);
    const targetCell = cellIndex(2, 7);
    match.players[0].reserve = [{ id: "r-bow", kind: "弓", level: 1, slot: 3 }];
    match.players[0].units = [{ id: "u-blade", kind: "刀", level: 2, cell: targetCell, cooldownMs: 480, attackCount: 4 }];
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "r-bow", targetCell }).ok).toBe(true);
    expect(match.players[0].units).toEqual([expect.objectContaining({ id: "u-bow", kind: "弓", cell: targetCell })]);
    expect(match.players[0].reserve).toEqual([expect.objectContaining({ id: "r-blade", kind: "刀", slot: 3 })]);
  });

  it("replaces a camp piece with an incompatible board piece in one drop", () => {
    const match = createMatch("TEST", 23);
    const sourceCell = cellIndex(2, 7);
    match.players[0].units = [{ id: "u-spear", kind: "枪", level: 2, cell: sourceCell, cooldownMs: 0, attackCount: 0 }];
    match.players[0].reserve = [{ id: "r-bow", kind: "弓", level: 1, slot: 1 }];
    expect(applyCommand(match, 0, { type: "DROP_UNIT_TO_RESERVE", unitId: "u-spear", targetSlot: 1 }).ok).toBe(true);
    expect(match.players[0].reserve).toEqual([expect.objectContaining({ id: "r-spear", kind: "枪", slot: 1 })]);
    expect(match.players[0].units).toEqual([expect.objectContaining({ id: "u-bow", kind: "弓", cell: sourceCell })]);
  });

  it("uses a shovel on any own 2_0 grass without an adjacency requirement", () => {
    const match = createMatch("TEST", 12);
    match.players[0].reserve = [{ id: "shovel", kind: "铲子", level: 1, slot: 0 }];
    const targetCell = cellIndex(6, 9);
    expect(match.players[0].unlockedCells.every((cell) => {
      const dx = Math.abs(cell % GAME_CONFIG.columns - targetCell % GAME_CONFIG.columns);
      const dy = Math.abs(Math.floor(cell / GAME_CONFIG.columns) - Math.floor(targetCell / GAME_CONFIG.columns));
      return dx + dy !== 1;
    })).toBe(true);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "shovel", targetCell }).ok).toBe(true);
    expect(match.players[0].unlockedCells).toContain(targetCell);
    expect(match.players[0].reserve).toHaveLength(0);
  });

  it("swaps same-kind board soldiers when their levels differ", () => {
    const match = createMatch("TEST", 201);
    const firstCell = cellIndex(2, 7);
    const secondCell = cellIndex(3, 7);
    match.players[0].units = [
      { id: "cavalry-2", kind: "骑", level: 2, cell: firstCell, cooldownMs: 0, attackCount: 0 },
      { id: "cavalry-3", kind: "骑", level: 3, cell: secondCell, cooldownMs: 0, attackCount: 0 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_UNIT", unitId: "cavalry-2", targetCell: secondCell }).ok).toBe(true);
    expect(match.players[0].units).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cavalry-2", cell: secondCell, level: 2 }),
      expect.objectContaining({ id: "cavalry-3", cell: firstCell, level: 3 }),
    ]));
    expect(match.players[0].lastEvent).toBe("交换「骑」与「骑」");
  });

  it("runs all twelve package boss skills through an authoritative cast and resolution lifecycle", () => {
    for (let bossType = 0; bossType < BOSS_CONFIGS.length; bossType += 1) {
      const match = bossFixture(bossType, true);
      stepMatch(match, 100);
      expect(match.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "boss-skill", bossType, phase: "cast" }),
      ]));
      let resolved = false;
      for (let frame = 0; frame < 80 && !resolved; frame += 1) {
        stepMatch(match, 100);
        resolved = match.events.some((event) => event.type === "boss-skill" && event.bossType === bossType && event.phase === "resolved");
      }
      expect(resolved, `Boss ${bossType} ${BOSS_CONFIGS[bossType]!.name} did not resolve`).toBe(true);
    }
  });

  it("applies the recovered boss target effects for control, summon, buff, terrain, weather, devour, knockdown, darkness and seal", () => {
    const soul = bossFixture(0, true);
    stepMatch(soul, 100); stepMatch(soul, 1_000);
    expect(soul.players[0].units[0]?.bossChaosMs).toBe(2_000);

    const inspire = bossFixture(2);
    inspire.players[0].enemies.push({
      id: "normal", hp: 10, maxHp: 10, progress: 0.4, boss: false, stunnedMs: 0,
      pathX: 4, pathY: 6, pathIndex: 7,
    });
    stepMatch(inspire, 100); stepMatch(inspire, 500);
    expect(inspire.players[0].enemies.find((enemy) => enemy.id === "normal")).toMatchObject({
      hp: 15, maxHp: 15, moveSpeedMultiplier: 1.3, moveSpeedBuffMs: 5_000, scaleMultiplier: 1.2,
    });

    const demolition = bossFixture(3);
    const openBefore = demolition.players[0].unlockedCells.length;
    stepMatch(demolition, 100); stepMatch(demolition, 500);
    expect(demolition.players[0].unlockedCells).toHaveLength(openBefore - 1);

    const rain = bossFixture(4, true);
    stepMatch(rain, 100); stepMatch(rain, 100);
    expect(rain.players[0].rainBossIds).toContain("boss-4");

    const charm = bossFixture(5, true);
    stepMatch(charm, 100); stepMatch(charm, 1_000);
    expect(charm.players[0].units).toHaveLength(0);
    expect(charm.players[0].enemies.some((enemy) => enemy.summonedKind === "puppet" && enemy.summonedUnitKind === "刀")).toBe(true);

    const cavalry = bossFixture(6);
    stepMatch(cavalry, 100); stepMatch(cavalry, 100);
    expect(cavalry.players[0].enemies.some((enemy) => enemy.summonedKind === "cavalry")).toBe(true);

    const suppression = bossFixture(7, true);
    stepMatch(suppression, 100); stepMatch(suppression, 650);
    expect(suppression.players[0].units[0]).toMatchObject({ level: 1, bossSuppressionOriginalLevel: 2, bossSuppressionMs: 5_000 });

    const devour = bossFixture(8);
    devour.players[0].enemies.push({
      id: "meal", hp: 10, maxHp: 10, progress: 0.4, boss: false, stunnedMs: 0,
      pathX: 4, pathY: 6, pathIndex: 7,
    });
    stepMatch(devour, 100); stepMatch(devour, 500);
    expect(devour.players[0].enemies.some((enemy) => enemy.id === "meal")).toBe(false);
    expect(devour.players[0].enemies[0]).toMatchObject({ maxHp: 10_020, hp: 10_020, scaleMultiplier: 1.01 });

    const knockdown = bossFixture(9, true);
    stepMatch(knockdown, 100); stepMatch(knockdown, 500);
    expect(knockdown.players[0].units[0]?.bossKnockedDown).toBe(true);

    const darkness = bossFixture(10);
    stepMatch(darkness, 100); stepMatch(darkness, 1_000);
    expect(darkness.players[0].visionDarkMs).toBe(5_000);

    const seal = bossFixture(11, true);
    stepMatch(seal, 100); stepMatch(seal, 1_000);
    expect(seal.players[0].units[0]?.bossLockedMs).toBe(-1);
  });

  it("revives up to three normal deaths as 张宝 zombies while 招魂 is active", () => {
    const match = bossFixture(1, true);
    const player = match.players[0];
    player.units[0]!.cooldownMs = 0;
    player.enemies.push({
      id: "fallen", hp: 1, maxHp: 1, progress: 0.45, boss: false, stunnedMs: 0,
      pathX: 4, pathY: 7, pathIndex: 8,
    });
    stepMatch(match, 100);
    expect(player.enemies.some((enemy) => enemy.summonedKind === "zombie")).toBe(true);
    expect(player.enemies.find((enemy) => enemy.id === "boss-1")?.resurrectionRemaining).toBe(2);
  });

  it("schedules 黄忠 arrow rain per recovered path cell, shuffled pixel offset and sequential 500–749ms delays", () => {
    const match = createMatch("HUANGZHONG-RAIN", 0xA220);
    const player = match.players[0];
    player.phase = "battle"; player.prepareMs = 0; player.spawnMs = 999_999; player.remainingToSpawn = 1;
    player.units = [{
      id: "huangzhong", kind: "黄忠", level: 5, cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7),
      parts: ["黄", "忠"], cooldownMs: 0, attackCount: 30,
    }];
    player.enemies = [{
      id: "target", hp: 10_000, maxHp: 10_000, progress: 0.4, boss: false, stunnedMs: 0,
      pathX: 4, pathY: 6, pathIndex: 7,
    }];

    stepMatch(match, 100);
    const impacts = player.pendingArrowImpacts ?? [];
    const path = expandedTestPath(match.mapIndex).slice(1);
    expect(impacts.length).toBeGreaterThanOrEqual(path.length * 2);
    expect(impacts.length).toBeLessThanOrEqual(path.length * 4);
    const delays = impacts.map((impact) => impact.remainingMs);
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThanOrEqual(749);
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]! - delays[index - 1]!).toBeGreaterThanOrEqual(500);
      expect(delays[index]! - delays[index - 1]!).toBeLessThanOrEqual(749);
    }
    for (const impact of impacts) {
      expect(path.some((cell) => Math.abs(impact.x - (cell.x + 0.5)) <= 24 / 80 + 1e-9
        && Math.abs(impact.y - (cell.y + 0.5)) <= 24 / 80 + 1e-9)).toBe(true);
      expect(impact.damage).toBeCloseTo(6 * 3.276 * 2, 8);
    }
    const firstDelay = impacts[0]!.remainingMs;
    stepMatch(match, firstDelay);
    expect(match.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "arrow-rain-impact", unitId: "huangzhong" }),
    ]));
  });

  it("uses the original one-frame node handoff without moving on that handoff frame", () => {
    const match = createMatch("NODE-HANDOFF", 3109);
    const player = match.players[0];
    const path = expandedTestPath(match.mapIndex);
    player.phase = "battle"; player.spawnMs = 999_999; player.remainingToSpawn = 1;
    player.enemies = [{
      id: "walker", hp: 100, maxHp: 100, progress: 1 / (path.length - 1), boss: false, stunnedMs: 0,
      pathX: path[1]!.x, pathY: path[1]!.y, pathIndex: 1,
    }];
    const before = { pathX: player.enemies[0]!.pathX, pathY: player.enemies[0]!.pathY };
    stepMatch(match, 100);
    expect(player.enemies[0]).toMatchObject({ ...before, pathIndex: 2 });
    stepMatch(match, 100);
    expect(player.enemies[0]!.pathY).not.toBe(before.pathY);
  });

  it("launches the recovered twelve-node bulldozer route at 50px/s and pushes on a 40px contact", () => {
    const match = createMatch("BULLDOZER", 3110);
    const player = match.players[0];
    const path = expandedTestPath(match.mapIndex);
    const startIndex = path.length - 2;
    player.phase = "battle"; player.spawnMs = 999_999; player.remainingToSpawn = 1;
    player.enemies = [{
      id: "near-adou", hp: 100, maxHp: 100, progress: startIndex / (path.length - 1), boss: false, stunnedMs: 0,
      pathX: path[startIndex]!.x, pathY: path[startIndex]!.y, pathIndex: startIndex,
    }];
    expect(applyCommand(match, 0, { type: "CLAIM_BULLDOZER_SUPPLY" }).ok).toBe(true);
    expect(player.props?.bulldozer?.routeIndices).toHaveLength(12);
    stepMatch(match, 100);
    expect(match.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "bulldozer", phase: "push", targetIds: ["near-adou"] }),
    ]));
    expect(player.enemies[0]).toMatchObject({
      pathIndex: startIndex,
      pathX: path[startIndex - 1]!.x,
      pathY: path[startIndex - 1]!.y,
    });
    expect(player.enemies[0]!.progress).toBeCloseTo((startIndex - 1) / (path.length - 1), 8);
  });

  it("awards a deterministic 1–10 bun treasure on every successful gold-seeker shovel", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const match = createMatch(`GOLD-${seed}`, seed);
      const player = match.players[0];
      player.reserve = [{ id: `gold-shovel-${seed}`, kind: "铲子", level: 1, slot: 0 }];
      player.props = {
        configured: true, loadout: { active: [], passive: [{ id: 24, level: 1 }] }, cooldowns: {}, placed: [],
        farmerSpawnMs: 30_000, superShovelMs: 60_000, meteorMs: 300_000,
      };
      const before = player.buns;
      expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: `gold-shovel-${seed}`, targetCell: cellIndex(6, 9) }).ok).toBe(true);
      const reward = player.buns - before;
      expect(reward).toBeGreaterThanOrEqual(1);
      expect(reward).toBeLessThanOrEqual(10);
      expect(match.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "prop-triggered", propId: 24, rewardBuns: reward }),
      ]));
    }
  });

  it("replaces 苞 in 张苞 with a reserve 飞 and returns 苞 to that same occupied reserve slot", () => {
    const match = createMatch("REPLACE-ZHANGBAO", 124);
    const left = cellIndex(2, 7);
    const right = cellIndex(3, 7);
    match.players[0].units = [{
      id: "general-zhangbao", kind: "张苞", level: 2,
      cell: left, secondaryCell: right, parts: ["张", "苞"], cooldownMs: 321, attackCount: 9,
    }];
    match.players[0].reserve = [
      { id: "reserve-fei", kind: "飞", level: 2, slot: 0 },
      ...Array.from({ length: GAME_CONFIG.reserveSize - 1 }, (_, index) => ({
        id: `occupied-${index + 1}`, kind: "刀", level: 1, slot: index + 1,
      })),
    ];

    const result = applyCommand(match, 0, {
      type: "DROP_RESERVE", reserveId: "reserve-fei", targetCell: right,
    });

    expect(result.ok).toBe(true);
    expect(match.players[0].units).toEqual([expect.objectContaining({
      id: "general-zhangbao", kind: "张飞", level: 2,
      cell: left, secondaryCell: right, parts: ["张", "飞"], cooldownMs: 0, attackCount: 0,
    })]);
    expect(match.players[0].reserve).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "reserve-fei", kind: "苞", level: 2, slot: 0 }),
    ]));
    expect(match.players[0].lastEvent).toBe("换字成将「张飞」Lv.2");
  });

  it("upgrades a general with the same-level matching character and splits into two upgraded characters", () => {
    const match = createMatch("UPGRADE-SPLIT-GENERAL", 125);
    const left = cellIndex(2, 7);
    const right = cellIndex(3, 7);
    const splitTarget = cellIndex(4, 8);
    match.players[0].units = [{
      id: "general", kind: "张飞", level: 1,
      cell: left, secondaryCell: right, parts: ["张", "飞"], cooldownMs: 0, attackCount: 0,
    }];
    match.players[0].reserve = [{ id: "reserve-fei", kind: "飞", level: 1, slot: 0 }];

    expect(applyCommand(match, 0, {
      type: "DROP_RESERVE", reserveId: "reserve-fei", targetCell: right,
    }).ok).toBe(true);
    expect(match.players[0].units[0]).toMatchObject({ kind: "张飞", level: 2 });
    expect(match.players[0].reserve).toHaveLength(0);

    expect(applyCommand(match, 0, {
      type: "SPLIT_GENERAL", unitId: "general", partIndex: 1, targetCell: splitTarget,
    }).ok).toBe(true);
    expect(match.players[0].units).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "张", level: 2, cell: left }),
      expect.objectContaining({ kind: "飞", level: 2, cell: splitTarget }),
    ]));
  });

  it("turns the original in-battle shovel ad into one direct grant of up to two shovels", () => {
    const match = createMatch("SUPPLY", 120);
    match.players[0].units = initialOpenCells(match.mapIndex).map((cell, index) => ({
      id: `placed-${index}`, kind: "刀", level: 1, cell, cooldownMs: 0, attackCount: 0,
    }));
    match.players[0].reserve = [{ id: "occupied", kind: "刀", level: 1, slot: 2 }];
    expect(applyCommand(match, 0, { type: "CLAIM_SHOVEL_SUPPLY" }).ok).toBe(true);
    expect(match.players[0].reserve.filter((item) => item.kind === "铲子")).toHaveLength(2);
    expect(match.players[0].props?.shovelSupplyClaimed).toBe(true);
    expect(applyCommand(match, 0, { type: "CLAIM_SHOVEL_SUPPLY" }).ok).toBe(false);
  });

  it("shows shovel supply only after all original white deployment cells are occupied", () => {
    const match = createMatch("SUPPLY-GATE", 121);
    expect(applyCommand(match, 0, { type: "CLAIM_SHOVEL_SUPPLY" }).ok).toBe(false);
    match.players[0].units = initialOpenCells(match.mapIndex).map((cell, index) => ({
      id: `placed-${index}`, kind: "刀", level: 1, cell, cooldownMs: 0, attackCount: 0,
    }));
    match.players[0].reserve = [{ id: "already-shovel", kind: "铲子", level: 1, slot: 0 }];
    expect(applyCommand(match, 0, { type: "CLAIM_SHOVEL_SUPPLY" }).ok).toBe(false);
  });

  it("strictly separates brown roads, green locked grass, and white deployment cells", () => {
    const match = createMatch("TEST", 19);
    const road = cellIndex(0, 9);
    const grass = cellIndex(1, 7);
    match.players[0].reserve = [
      { id: "soldier", kind: "刀", level: 1, slot: 0 },
      { id: "shovel", kind: "铲子", level: 1, slot: 1 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "soldier", targetCell: road }).ok).toBe(false);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "soldier", targetCell: grass }).ok).toBe(false);
    expect(match.players[0].units).toHaveLength(0);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "shovel", targetCell: grass }).ok).toBe(true);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "soldier", targetCell: grass }).ok).toBe(true);
    expect(match.players[0].units[0]?.cell).toBe(grass);
  });

  it("awards ten buns when A Dou loses one life", () => {
    const match = createMatch("TEST", 13);
    const player = match.players[0];
    player.phase = "battle";
    player.prepareMs = 0;
    player.spawnMs = 999999;
    player.enemies = [{ id: "escape", hp: 10, maxHp: 10, progress: 0.999, boss: false, stunnedMs: 0 }];
    const before = player.buns;
    stepMatch(match, 100);
    expect(player.hp).toBe(GAME_CONFIG.baseHp - 1);
    expect(player.buns).toBe(before + GAME_CONFIG.hpLostBuns);
  });

  it("emits authoritative combat effects when an attack lands", () => {
    const match = createMatch("TEST", 18);
    const player = match.players[0];
    player.phase = "battle";
    player.prepareMs = 0;
    player.spawnMs = 999999;
    player.remainingToSpawn = 1;
    player.units = [{ id: "blade", kind: "刀", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 }];
    player.enemies = [{ id: "target", hp: 20, maxHp: 20, progress: 5 / 17, boss: false, stunnedMs: 0 }];
    stepMatch(match, 100);
    expect(match.combatEvents).toHaveLength(1);
    expect(match.combatEvents[0]).toMatchObject({ unitId: "blade", targetId: "target", damage: 3, hitCount: 1 });
  });

  it("restores 赵云 five-thrust normal attacks and starts a 300px/s seven-round-trip phantom", () => {
    const match = generalSkillFixture("赵云", 29, 1_000);
    stepMatch(match, 100);
    const player = match.players[0];
    expect(player.enemies[0]!.hp).toBe(990);
    expect(match.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "general-skill", unitKind: "赵云", skillName: "七进七出" }),
      expect.objectContaining({ type: "attack", unitKind: "赵云", damage: 10, hitCount: 5 }),
    ]));
    expect(player.zhaoPhantoms).toEqual([
      expect.objectContaining({ unitId: "general-赵云", direction: -1, roundTrips: 0, launchMs: 500, damage: 2 }),
    ]);
    expect(GENERAL_SKILLS.赵云).toMatchObject({ phantomSpeedPxPerSec: 300, roundTrips: 7, pulseMs: 100 });
  });

  it("restores 张飞 大喝 and the per-hit 10% movement slow for two seconds", () => {
    const match = generalSkillFixture("张飞", 15);
    stepMatch(match, 100);
    expect(match.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "general-skill", unitKind: "张飞", skillName: "大喝" }),
    ]));
    expect(match.players[0].enemies[0]).toMatchObject({
      stunnedMs: 1_900, generalSlowMultiplier: 0.9, generalSlowMs: 2_000,
    });
  });

  it("restores 马超 proc damage from normal-enemy max HP in addition to stun", () => {
    const match = generalSkillFixture("马超", 0, 1_000);
    // 攻击结算发生在 tick=1、attackCount=1，固定挑一个落入 30% 分支的种子。
    match.seed = Array.from({ length: 10_000 }, (_, seed) => seed)
      .find((seed) => createRng(seed ^ 1 ^ 1 ^ "general-马超".length).next() < GENERAL_SKILLS.马超.normalChance)!;
    stepMatch(match, 100);
    expect(match.players[0].enemies[0]!.hp).toBe(890);
    expect(match.players[0].enemies[0]!.stunnedMs).toBe(400);
    expect(match.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "attack", unitKind: "马超", damage: 110, skillName: "晕眩" }),
    ]));
  });

  it("restores 关羽 same-target ramp and queues five sequential 跳斩 impacts", () => {
    const match = generalSkillFixture("关羽", 0);
    const player = match.players[0];
    stepMatch(match, 100);
    expect(player.enemies[0]!.hp).toBe(9_980);
    player.units[0]!.cooldownMs = 0;
    stepMatch(match, 100);
    expect(player.enemies[0]!.hp).toBe(9_959);
    expect(player.units[0]).toMatchObject({ repeatedTargetId: "target", repeatedTargetAttackBonus: 0.05 });
    player.units[0]!.cooldownMs = 0; player.units[0]!.attackCount = 20;
    stepMatch(match, 100);
    expect(player.pendingGeneralImpacts).toHaveLength(5);
    expect(player.pendingGeneralImpacts!.map((impact) => impact.remainingMs)).toEqual(
      [1, 2, 3, 4, 5].map((index) => index * 500 / 1.2),
    );
    expect(match.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "general-skill", unitKind: "关羽", skillName: "跳斩" }),
    ]));
  });

  it("keeps 刘备 圣剑 and 黄祖 five-round arrow rain as delayed projectiles", () => {
    const liuBei = generalSkillFixture("刘备", 19);
    stepMatch(liuBei, 100);
    expect(liuBei.players[0].enemies[0]!.hp).toBe(9_990);
    expect(liuBei.players[0].pendingGeneralImpacts).toEqual([
      expect.objectContaining({ kind: "holy-sword", skillName: "圣剑", damage: 50, stunMs: 2_000 }),
    ]);
    const swordDelay = liuBei.players[0].pendingGeneralImpacts![0]!.remainingMs;
    stepMatch(liuBei, swordDelay);
    expect(liuBei.players[0].enemies[0]!.hp).toBe(9_940);
    expect(liuBei.players[0].enemies[0]!.stunnedMs).toBeGreaterThanOrEqual(1_900);

    const huangZu = generalSkillFixture("黄祖", 30);
    stepMatch(huangZu, 100);
    expect(huangZu.players[0].enemies[0]!.hp).toBe(9_994);
    expect(huangZu.players[0].pendingGeneralImpacts).toHaveLength(50);
    const delays = huangZu.players[0].pendingGeneralImpacts!.map((impact) => impact.remainingMs);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(1_000);
    expect(Math.max(...delays)).toBeLessThanOrEqual(3_199);
    expect(new Set(huangZu.players[0].pendingGeneralImpacts!.map((impact) => impact.kind))).toEqual(new Set(["huangzu-arrow"]));
  });

  it("automatically levels a general when an attributed kill reaches its cumulative experience threshold", () => {
    const match = createMatch("GENERAL-XP", 109);
    const player = match.players[0];
    player.phase = "battle";
    player.prepareMs = 0;
    player.spawnMs = 999_999;
    player.remainingToSpawn = 1;
    player.units = [{
      id: "zhaoyun", kind: "赵云", level: 1, experience: 9,
      cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7), parts: ["赵", "云"],
      cooldownMs: 0, attackCount: 0,
    }];
    player.enemies = [{ id: "xp-target", hp: 1, maxHp: 1, progress: 5 / 17, boss: false, stunnedMs: 0 }];

    stepMatch(match, 100);

    expect(player.units[0]).toMatchObject({ kind: "赵云", level: 2, experience: 10, cooldownMs: 0, attackCount: 0 });
    expect(match.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "unit-upgraded", unitId: "zhaoyun", fromLevel: 1, toLevel: 2,
        experience: 10, source: "combat-experience",
      }),
    ]));
  });

  it("gives a level-two spear the original 0.533-second attack interval without cooldown debt", () => {
    const match = createMatch("TEST", 24);
    const player = match.players[0];
    player.phase = "battle";
    player.prepareMs = 0;
    player.spawnMs = 999999;
    player.remainingToSpawn = 1;
    player.units = [{ id: "spear", kind: "枪", level: 2, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 }];
    player.enemies = [{ id: "target", hp: 100, maxHp: 100, progress: 5 / 17, boss: false, stunnedMs: 0 }];
    for (let index = 0; index < 5; index += 1) stepMatch(match, 100);
    expect(player.units[0]?.attackCount).toBe(1);
    stepMatch(match, 100);
    expect(player.units[0]?.attackCount).toBe(2);
  });

  it("applies the original first-ten-match HP ramp only through wave ten", () => {
    expect(INTRO_ROUND_HP_MULTIPLIERS).toEqual([0.6, 0.6, 0.6, 0.6, 0.7, 0.7, 0.7, 0.8, 0.8, 0.8]);
    const match = createMatch("INTRO", 25, 0, [0, 10]);
    match.difficultyCurve = 0;
    for (const player of match.players) {
      player.phase = "battle";
      player.prepareMs = 0;
      player.spawnMs = 0;
      player.remainingToSpawn = 2;
    }
    stepMatch(match, 100);
    expect(match.players[0].enemies[0]?.maxHp).toBe(6);
    expect(match.players[1].enemies[0]?.maxHp).toBe(10);

    match.players[0].wave = 11;
    match.players[0].enemies = [];
    match.players[0].spawnMs = 0;
    match.players[0].remainingToSpawn = 2;
    stepMatch(match, 100);
    expect(match.players[0].enemies[0]?.maxHp).toBe(611);
  });

  it("cycles each map's three original bosses with 7/10/14 HP and 10px/s movement", () => {
    const match = createMatch("BOSS", 26, 0);
    match.difficultyCurve = 0;
    match.bossWaves = [3, 6, 9];
    const player = match.players[0];
    player.phase = "battle";
    player.wave = 6;
    player.spawnMs = 0;
    player.remainingToSpawn = 1;
    stepMatch(match, 100);
    const boss = player.enemies[0]!;
    expect(boss.bossType).toBe(1);
    expect(boss.maxHp).toBe(92 * BOSS_CONFIGS[1].hpMultiplier);
    expect(boss.progress).toBeCloseTo(0.1 * 10 / (pathLengthCells(0) * GAME_CONFIG.cellSize), 12);
  });

  it("moves normal enemies at the package's map-independent 50px/s", () => {
    for (let mapIndex = 0; mapIndex < MAP_LAYOUTS.length; mapIndex += 1) {
      const match = createMatch(`SPEED-${mapIndex}`, 27, mapIndex);
      const player = match.players[0];
      player.phase = "battle";
      player.spawnMs = 999_999;
      player.remainingToSpawn = 1;
      player.enemies = [{ id: "walker", hp: 10, maxHp: 10, progress: 0, boss: false, stunnedMs: 0 }];
      stepMatch(match, 1_000);
      expect(player.enemies[0]?.progress).toBeCloseTo(
        NORMAL_ENEMY_SPEED_PX_PER_SEC / (pathLengthCells(mapIndex) * GAME_CONFIG.cellSize), 12,
      );
    }
  });

  it("allows farmers to merge through level five and uses level production intervals", () => {
    const match = createMatch("FARMER", 28);
    const player = match.players[0];
    player.reserve = [
      { id: "farmer-a", kind: "农", level: 1, slot: 0, incomeMs: 20_000 },
      { id: "farmer-b", kind: "农", level: 1, slot: 1, incomeMs: 20_000 },
    ];
    expect(applyCommand(match, 0, { type: "DROP_RESERVE_TO_SLOT", reserveId: "farmer-a", targetSlot: 1 }).ok).toBe(true);
    expect(player.reserve).toEqual([expect.objectContaining({ id: "farmer-b", kind: "农", level: 2 })]);
    player.phase = "battle";
    player.spawnMs = 999_999;
    player.remainingToSpawn = 1;
    player.reserve[0]!.incomeMs = 10_000;
    const buns = player.buns;
    stepMatch(match, 10_000);
    expect(player.buns).toBe(buns + 1);
  });

  it("limits 御敌千里 to bows and generals, and consumes 包子 after ten uses", () => {
    const match = createMatch("PROP-ORIGINAL", 29);
    const player = match.players[0];
    player.units = [
      { id: "knife", kind: "刀", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 },
      { id: "bow", kind: "弓", level: 1, cell: cellIndex(3, 7), cooldownMs: 0, attackCount: 0 },
    ];
    expect(applyCommand(match, 0, { type: "SET_PROP_LOADOUT", loadout: { active: [5, 6], passive: [] } }).ok).toBe(true);
    expect(applyCommand(match, 0, { type: "USE_PROP", propId: 6, targetUnitId: "knife" }).ok).toBe(false);
    expect(applyCommand(match, 0, { type: "USE_PROP", propId: 6, targetUnitId: "bow" }).ok).toBe(true);
    expect(player.units[1]?.rangeMultiplier).toBe(2);
    for (let use = 0; use < 10; use += 1) {
      player.props!.cooldowns[5] = 0;
      expect(applyCommand(match, 0, { type: "USE_PROP", propId: 5 }).ok).toBe(true);
    }
    expect(player.props?.charges?.[5]).toBe(0);
    expect(player.props?.loadout.active).not.toContain(5);
  });

  it("keeps both mirrored armies on their own roads and half of the battlefield", () => {
    for (let mapIndex = 0; mapIndex < MAP_LAYOUTS.length; mapIndex += 1) {
      for (let sample = 0; sample <= 100; sample += 1) {
        const point = pathPoint(mapIndex, sample / 100);
        const ownX = Math.round(point.x); const ownY = Math.round(point.y);
        const enemyX = GAME_CONFIG.columns - 1 - ownX;
        const enemyY = GAME_CONFIG.rows - 1 - ownY;
        expect(cellCode(mapIndex, cellIndex(ownX, ownY))).toBe("0_0");
        expect(cellCode(mapIndex, cellIndex(enemyX, enemyY))).toBe("0_1");
        expect(point.y).toBeGreaterThanOrEqual(4);
        expect(GAME_CONFIG.rows - 1 - point.y).toBeLessThanOrEqual(5);
      }
    }
  });

  it("produces the same opening plan for the same seed", () => {
    const a = createMatch("A", 0xC0FFEE);
    const b = createMatch("B", 0xC0FFEE);
    expect(a.difficultyCurve).toBe(b.difficultyCurve);
    expect(a.bossWaves).toEqual(b.bossWaves);
  });

  it("uses the package circle-to-full-cell attack collision so an edge touch hits", () => {
    expect(attackRangeIntersectsCell({ x: 0, y: 0 }, { x: 2.487, y: 0 }, 2)).toBe(true);
    expect(attackRangeIntersectsCell({ x: 0, y: 0 }, { x: 2.489, y: 0 }, 2)).toBe(false);
  });

  it("uses the first-three-daily-matches shovel pool of 13/110", () => {
    let shovels = 0;
    let total = 0;
    for (let seed = 1; seed <= 2_000; seed += 1) {
      const match = createMatch("POOL", seed);
      applyCommand(match, 0, { type: "SET_PROP_LOADOUT", loadout: { active: [], passive: [] }, earlyAccountShovelBonus: true });
      applyCommand(match, 0, { type: "RECRUIT" });
      shovels += match.players[0].reserve.filter((item) => item.kind === "铲子").length;
      total += match.players[0].reserve.length;
    }
    expect(shovels / total).toBeGreaterThan(0.105);
    expect(shovels / total).toBeLessThan(0.13);
  });

  it("keeps one persistent recruitment pool and consumes drawn general-name copies", () => {
    const match = createMatch("PERSISTENT-POOL", 0x109);
    const player = match.players[0];
    player.buns = 1_000_000;
    expect(applyCommand(match, 0, {
      type: "SET_PROP_LOADOUT",
      loadout: { active: [], passive: [{ id: 13, level: 1 }] },
    }).ok).toBe(true);
    const drawnNames: Record<string, number> = {};
    const nameKinds = new Set(["赵", "云", "张", "飞", "马", "超", "关", "羽", "平", "兴", "黄", "忠", "苞", "翼", "盖", "祖", "刘", "备"]);
    for (let draw = 0; draw < 80; draw += 1) {
      expect(applyCommand(match, 0, { type: "RECRUIT" }).ok).toBe(true);
      for (const item of player.reserve) if (nameKinds.has(item.kind)) {
        drawnNames[item.kind] = (drawnNames[item.kind] ?? 0) + 1;
      }
    }
    const baseNameWeights = Object.fromEntries(TOKEN_POOL.filter(([kind]) => nameKinds.has(kind)));
    for (const [kind, count] of Object.entries(drawnNames)) expect(count).toBeLessThanOrEqual(baseNameWeights[kind] ?? 0);
    expect(player.recruitNameBonusApplied).toBe(true);
    expect(player.recruitPool?.filter((kind) => kind === "刀")).toHaveLength(21);
  });

  it("loads the complete 25-row package prop catalog and enforces 2+6 slots", () => {
    expect(PROPS).toHaveLength(25);
    const match = createMatch("PROPS", 91);
    expect(applyCommand(match, 0, {
      type: "SET_PROP_LOADOUT",
      loadout: { active: [3, 8], passive: [{ id: 12, level: 1 }, { id: 16, level: 1 }, { id: 22, level: 3 }] },
    }).ok).toBe(true);
    expect(match.players[0].maxHp).toBe(8);
    expect(match.players[1].maxHp).toBe(6);
  });

  it("applies the package training-spell and trap values", () => {
    const match = createMatch("PROP-EFFECT", 92);
    const player = match.players[0];
    player.units = [{ id: "blade", kind: "刀", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 }];
    expect(applyCommand(match, 0, { type: "SET_PROP_LOADOUT", loadout: { active: [3, 8], passive: [] } }).ok).toBe(true);
    expect(applyCommand(match, 0, { type: "USE_PROP", propId: 3, targetUnitId: "blade" }).ok).toBe(true);
    expect(player.units[0]?.level).toBe(2);
    expect(player.props?.cooldowns[3]).toBe(65_000);
    expect(applyCommand(match, 0, { type: "USE_PROP", propId: 8, targetCell: cellIndex(0, 9) }).ok).toBe(true);
    player.phase = "battle";
    player.spawnMs = 999_999;
    player.enemies = [{ id: "trap-target", hp: 10, maxHp: 10, progress: 0, boss: false, stunnedMs: 0 }];
    stepMatch(match, 100);
    expect(player.enemies[0]?.stunnedMs).toBe(4_900);
  });
});

describe("project battle buff drops", () => {
  function buffMatch() {
    const match = createMatch("BATTLE-BUFF", 47);
    match.phase = "battle";
    for (const player of match.players) {
      player.phase = "battle";
      player.prepareMs = 0;
      player.spawnMs = 999_999;
      player.remainingToSpawn = 1;
      player.units = [];
      player.enemies = [];
    }
    return match;
  }

  it("stores deterministic 8% normal-enemy drops in the current-match inventory with four uniform kinds", () => {
    const match = buffMatch();
    const defender = match.players[0];
    defender.units = [{ id: "killer", kind: "刀", level: 5, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 }];
    const counts = new Map(BATTLE_BUFFS.map((buff) => [buff.kind, 0]));
    for (let index = 0; index < 2_000; index += 1) {
      defender.units[0]!.cooldownMs = 0;
      defender.enemies = [{
        id: `drop-candidate-${index}`, hp: 1, maxHp: 1, progress: 0.4, boss: false, stunnedMs: 100_000,
        pathX: 2, pathY: 7, pathIndex: 1,
      }];
      stepMatch(match, 100);
      const event = match.events.find((candidate) => candidate.type === "battle-buff-dropped");
      if (event?.type === "battle-buff-dropped") counts.set(event.buffKind, (counts.get(event.buffKind) ?? 0) + 1);
    }
    expect(defender.battleBuffs).toHaveLength([...counts.values()].reduce((sum, count) => sum + count, 0));
    expect(defender.battleBuffs!.length).toBeGreaterThanOrEqual(120);
    expect(defender.battleBuffs!.length).toBeLessThanOrEqual(200);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThanOrEqual(20);
      expect(count).toBeLessThanOrEqual(65);
    }
  });

  it("applies all four buffs only to live monsters attacking the opponent and consumes on success", () => {
    const match = buffMatch();
    const owner = match.players[0];
    const opponent = match.players[1];
    owner.battleBuffs = BATTLE_BUFFS.map((buff, index) => ({ id: `buff-${index}`, kind: buff.kind }));
    opponent.enemies = [
      { id: "center", hp: 100, maxHp: 100, progress: 0.2, boss: false, stunnedMs: 100_000, pathX: 0, pathY: 9, pathIndex: 1 },
      { id: "near", hp: 200, maxHp: 200, progress: 0.3, boss: false, stunnedMs: 100_000, pathX: 0, pathY: 7, pathIndex: 1 },
      { id: "far", hp: 300, maxHp: 300, progress: 0.4, boss: true, bossType: 0, stunnedMs: 100_000, pathX: 4, pathY: 7, pathIndex: 1 },
    ];

    expect(applyCommand(match, 0, { type: "USE_BATTLE_BUFF", buffInstanceId: "buff-0", targetEnemyId: "center" }).ok).toBe(true);
    expect(opponent.enemies[0]!.battleInvulnerableMs).toBe(5_000);
    expect(applyCommand(match, 0, { type: "USE_BATTLE_BUFF", buffInstanceId: "buff-1", targetEnemyId: "center" }).ok).toBe(true);
    expect(opponent.enemies[0]!.battleHasteMs).toBe(10_000);
    expect(applyCommand(match, 0, { type: "USE_BATTLE_BUFF", buffInstanceId: "buff-2", targetEnemyId: "far" }).ok).toBe(true);
    expect(opponent.enemies[2]).toMatchObject({ hp: 750, maxHp: 750, battleGiantApplied: true });
    expect(applyCommand(match, 0, { type: "USE_BATTLE_BUFF", buffInstanceId: "buff-3", targetEnemyId: "center" }).ok).toBe(true);
    expect(opponent.enemies[0]).toMatchObject({ hp: 120, maxHp: 120, battleRallyMs: 6_000 });
    expect(opponent.enemies[1]).toMatchObject({ hp: 240, maxHp: 240, battleRallyMs: 6_000 });
    expect(opponent.enemies[2]!.battleRallyMs).toBeUndefined();
    expect(owner.battleBuffs).toEqual([]);
    expect(match.events.at(-1)).toMatchObject({
      type: "battle-buff-used", buffKind: "rally", targetSlot: 1,
      targetEnemyId: "center", affectedEnemyIds: ["center", "near"],
    });
  });

  it("keeps immunity authoritative, expires timed bonuses, and rejects duplicate giant use without consuming", () => {
    const match = buffMatch();
    const owner = match.players[0];
    const opponent = match.players[1];
    owner.battleBuffs = [
      { id: "immune", kind: "invulnerable" },
      { id: "rally", kind: "rally" },
      { id: "giant-a", kind: "giant" },
      { id: "giant-b", kind: "giant" },
    ];
    opponent.units = [{ id: "attacker", kind: "刀", level: 5, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 }];
    opponent.enemies = [{
      id: "target", hp: 100, maxHp: 100, progress: 0.4, boss: false, stunnedMs: 100_000,
      pathX: 2, pathY: 7, pathIndex: 1,
    }];
    expect(applyCommand(match, 0, { type: "USE_BATTLE_BUFF", buffInstanceId: "immune", targetEnemyId: "target" }).ok).toBe(true);
    stepMatch(match, 100);
    expect(opponent.enemies[0]!.hp).toBe(100);
    expect(match.events.find((event) => event.type === "attack")).toMatchObject({ type: "attack", damage: 0 });

    expect(applyCommand(match, 0, { type: "USE_BATTLE_BUFF", buffInstanceId: "rally", targetEnemyId: "target" }).ok).toBe(true);
    opponent.units = [];
    stepMatch(match, 6_000);
    expect(opponent.enemies[0]).toMatchObject({ hp: 100, maxHp: 100, battleRallyMs: 0, battleRallyBonusHp: 0 });

    expect(applyCommand(match, 0, { type: "USE_BATTLE_BUFF", buffInstanceId: "giant-a", targetEnemyId: "target" }).ok).toBe(true);
    const duplicate = applyCommand(match, 0, { type: "USE_BATTLE_BUFF", buffInstanceId: "giant-b", targetEnemyId: "target" });
    expect(duplicate).toMatchObject({ ok: false, message: "该怪物已经获得巨灵效果" });
    expect(owner.battleBuffs).toContainEqual({ id: "giant-b", kind: "giant" });
  });

  it("keeps an invulnerable monster alive when it triggers an instant-kill landmine", () => {
    const match = buffMatch();
    const defender = match.players[0];
    defender.props!.placed = [{ id: "mine", propId: 9, cell: cellIndex(0, 9) }];
    defender.enemies = [{
      id: "immune-trap-target", hp: 100, maxHp: 100, progress: 0, boss: false, stunnedMs: 0,
      pathX: 0, pathY: 9, pathIndex: 1, battleInvulnerableMs: 5_000,
    }];

    stepMatch(match, 100);

    expect(defender.enemies).toContainEqual(expect.objectContaining({ id: "immune-trap-target", hp: 100 }));
    expect(defender.props!.placed).toEqual([]);
  });

  it("multiplies movement by 2x for haste and by 1.2x for rally", () => {
    const distanceAfter = (kind?: "haste" | "rally") => {
      const match = buffMatch();
      const enemy = {
        id: `walker-${kind ?? "plain"}`, hp: 100, maxHp: 100, progress: 0, boss: false, stunnedMs: 0,
        pathX: 0, pathY: 9, pathIndex: 1,
        ...(kind === "haste" ? { battleHasteMs: 10_000 } : {}),
        ...(kind === "rally" ? { battleRallyMs: 6_000, battleRallyBonusHp: 20 } : {}),
      };
      match.players[0].enemies = [enemy];
      stepMatch(match, 400);
      return 9 - (match.players[0].enemies[0]!.pathY ?? 9);
    };
    const plain = distanceAfter();
    expect(distanceAfter("haste")).toBeCloseTo(plain * 2, 8);
    expect(distanceAfter("rally")).toBeCloseTo(plain * 1.2, 8);
  });
});
