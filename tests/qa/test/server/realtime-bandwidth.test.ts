import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  REALTIME_SYNC_CONFIG, createMatch,
  type AppliedCommandPayload, type EnemyState, type UnitState,
} from "@adou/shared";

function representativeLateMatch() {
  const snapshot = createMatch("BANDWIDTH", 0x109, 3, [20, 20]);
  snapshot.phase = "battle";
  snapshot.tick = 18_000;
  snapshot.simulationTimeMs = 1_800_000;
  snapshot.stateVersion = 18_000;

  for (const player of snapshot.players) {
    player.phase = "battle";
    player.wave = 20;
    player.units = Array.from({ length: 24 }, (_, index): UnitState => ({
      id: `unit-${player.slot}-${index}-${"x".repeat(12)}`,
      kind: index % 4 === 0 ? "赵云" : ["刀", "弓", "枪", "骑"][index % 4]!,
      level: 5,
      cell: index,
      secondaryCell: index % 4 === 0 ? index + 1 : undefined,
      cooldownMs: 700,
      attackCount: 200 + index,
      experience: 130,
      rangeMultiplier: 1.2,
      attackSpeedMultiplier: 1.5,
    }));
    player.enemies = Array.from({ length: 64 }, (_, index): EnemyState => ({
      id: `enemy-${player.slot}-${index}-${"y".repeat(12)}`,
      hp: 10_000 + index,
      maxHp: 17_315,
      progress: index / 80,
      boss: index % 20 === 0,
      bossType: index % 12,
      stunnedMs: index % 3 === 0 ? 500 : 0,
      pathX: (index % 8) + 0.375,
      pathY: (index % 10) + 0.625,
      pathIndex: index % 20,
      moveSpeedMultiplier: 1.2,
      moveSpeedBuffMs: 6_000,
      scaleMultiplier: index % 7 === 0 ? 2 : 1,
      battleInvulnerableMs: index % 5 === 0 ? 5_000 : 0,
      battleHasteMs: index % 4 === 0 ? 10_000 : 0,
      battleRallyMs: index % 3 === 0 ? 6_000 : 0,
    }));
    player.battleBuffs = ["invulnerable", "haste", "giant", "rally", "smoke", "decoy"].map((kind, index) => ({
      id: `buff-${player.slot}-${index}`,
      kind: kind as "invulnerable" | "haste" | "giant" | "rally" | "smoke" | "decoy",
    }));
    player.battleFieldEffects = [
      { id: `smoke-${player.slot}`, kind: "smoke", cell: 37, remainingMs: 6_000 },
      { id: `decoy-${player.slot}`, kind: "decoy", cell: 42, remainingHits: 10 },
    ];
  }
  snapshot.acceptedCommands = {};
  snapshot.combatEvents = [];
  return snapshot;
}

describe("realtime bandwidth budget", () => {
  it("keeps ten busy rooms below the safe share of a 3 Mbps uplink", () => {
    const snapshotJson = JSON.stringify(["match:checkpoint", representativeLateMatch()]);
    const checkpointBytes = deflateRawSync(Buffer.from(snapshotJson), { level: 6 }).byteLength + 32;
    const command: AppliedCommandPayload = {
      slot: 1,
      commandId: "2dd89795-599a-4c89-a993-2118b1ae17bb",
      clientSeq: 88,
      command: { type: "USE_BATTLE_BUFF", buffInstanceId: "buff-1-5", targetCell: 42 },
      serverTick: 18_000,
      serverStateVersionBefore: 18_087,
      serverStateVersion: 18_088,
      serverEventSequenceBefore: 5_400,
    };
    const commandBytes = Buffer.byteLength(JSON.stringify(["match:command-applied", command])) + 32;

    const roomCount = 10;
    const clientsPerRoom = 2;
    const commandsPerSecondPerPlayer = 4;
    const checkpointBytesPerSecond = roomCount * clientsPerRoom * checkpointBytes
      / (REALTIME_SYNC_CONFIG.checkpointIntervalMs / 1_000);
    const commandBytesPerSecond = roomCount * clientsPerRoom * clientsPerRoom
      * commandsPerSecondPerPlayer * commandBytes;
    const estimatedBytesPerSecond = checkpointBytesPerSecond + commandBytesPerSecond;
    const safeUplinkBudget = (3_000_000 / 8) * 0.65;

    expect(estimatedBytesPerSecond).toBeLessThan(safeUplinkBudget);

    const oldSnapshotStreamBytesPerSecond = roomCount * clientsPerRoom * 10
      * Buffer.byteLength(snapshotJson);
    expect(estimatedBytesPerSecond).toBeLessThan(oldSnapshotStreamBytesPerSecond * 0.1);
  });
});
