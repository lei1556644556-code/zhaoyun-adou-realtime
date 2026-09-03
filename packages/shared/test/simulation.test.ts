import { describe, expect, it } from "vitest";
import { GAME_CONFIG, MAP_LAYOUTS, PROPS, applyCommand, attackRangeIntersectsCell, cellCode, cellIndex, createMatch, initialOpenCells, pathPoint, stepMatch } from "../src";

describe("1.0.9 authoritative simulation", () => {
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

    const versionBefore = match.stateVersion;
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "r-yun", targetCell: secondCell }).ok).toBe(true);
    expect(match.stateVersion).toBe(versionBefore + 1);
    expect(match.players[0].units).toEqual([{
      id: "zhao", kind: "赵云", level: 1,
      cell: firstCell, secondaryCell: secondCell, parts: ["赵", "云"],
      cooldownMs: 0, attackCount: 0,
    }]);
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

  it("uses a shovel only on adjacent own grass", () => {
    const match = createMatch("TEST", 12);
    match.players[0].reserve = [{ id: "shovel", kind: "铲子", level: 1, slot: 0 }];
    const targetCell = cellIndex(1, 7);
    expect(applyCommand(match, 0, { type: "DROP_RESERVE", reserveId: "shovel", targetCell }).ok).toBe(true);
    expect(match.players[0].unlockedCells).toContain(targetCell);
    expect(match.players[0].reserve).toHaveLength(0);
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

  it("gives a level-two spear the configured 0.62-second attack interval without extra attacks", () => {
    const match = createMatch("TEST", 24);
    const player = match.players[0];
    player.phase = "battle";
    player.prepareMs = 0;
    player.spawnMs = 999999;
    player.remainingToSpawn = 1;
    player.units = [{ id: "spear", kind: "枪", level: 2, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0 }];
    player.enemies = [{ id: "target", hp: 100, maxHp: 100, progress: 5 / 17, boss: false, stunnedMs: 0 }];
    for (let index = 0; index < 6; index += 1) stepMatch(match, 100);
    expect(player.units[0]?.attackCount).toBe(1);
    stepMatch(match, 100);
    expect(player.units[0]?.attackCount).toBe(2);
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

  it("uses the early-account effective shovel pool of 13/110", () => {
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
