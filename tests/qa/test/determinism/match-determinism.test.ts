import { describe, expect, it } from "vitest";
import { applyCommand, cloneSnapshot, createMatch, initialOpenCells, stepMatch, type GameCommand, type MatchSnapshot } from "@adou/shared";

function canonical(snapshot: MatchSnapshot) {
  const { serverTime: _serverTime, ...value } = cloneSnapshot(snapshot);
  return value;
}

function runCommandStream(snapshot: MatchSnapshot) {
  const commands: GameCommand[] = [
    { type: "SET_PROP_LOADOUT", loadout: { active: [3, 8], passive: [{ id: 17, level: 1 }] } },
    { type: "RECRUIT" },
  ];
  for (const command of commands) expect(applyCommand(snapshot, 0, command).ok).toBe(true);
  const reserve = snapshot.players[0].reserve[0]!;
  expect(applyCommand(snapshot, 0, {
    type: "DROP_RESERVE", reserveId: reserve.id, targetCell: initialOpenCells(snapshot.mapIndex)[0]!,
  }).ok).toBe(true);
  for (let index = 0; index < 120; index += 1) stepMatch(snapshot, 100);
}

describe("deterministic match and snapshot recovery", () => {
  it("replays the same command/tick stream to an identical authoritative state", () => {
    const first = createMatch("DETERMINISTIC", 0x5a17, 2);
    const second = createMatch("DETERMINISTIC", 0x5a17, 2);
    runCommandStream(first);
    runCommandStream(second);
    expect(canonical(first)).toEqual(canonical(second));
  });

  it("continues identically after a JSON snapshot round trip", () => {
    const original = createMatch("RESTORE", 0x109, 1);
    expect(applyCommand(original, 0, { type: "RECRUIT" }).ok).toBe(true);
    for (let index = 0; index < 37; index += 1) stepMatch(original, 100);
    const restored = JSON.parse(JSON.stringify(original)) as MatchSnapshot;
    for (let index = 0; index < 80; index += 1) {
      stepMatch(original, 100);
      stepMatch(restored, 100);
    }
    expect(restored).toEqual(original);
  });

  it("deep-clones snapshots so transport consumers cannot mutate authority", () => {
    const authority = createMatch("CLONE", 44);
    const consumer = cloneSnapshot(authority);
    consumer.players[0].buns = 999;
    consumer.players[0].unlockedCells.push(0);
    expect(authority.players[0].buns).not.toBe(999);
    expect(authority.players[0].unlockedCells).not.toContain(0);
  });
});
