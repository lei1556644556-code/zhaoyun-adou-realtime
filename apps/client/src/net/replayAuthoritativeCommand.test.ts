import { describe, expect, it } from "vitest";
import {
  cloneSnapshot, createMatch, executeCommand, stepMatch,
  type AppliedCommandPayload,
} from "@adou/shared";
import { replayAuthoritativeCommand } from "./replayAuthoritativeCommand";

describe("authoritative command replay", () => {
  it("reproduces command randomness when the client is already one Tick ahead", () => {
    const initial = createMatch("LOCAL-REPLAY", 0x109);
    const server = cloneSnapshot(initial);
    const client = cloneSnapshot(initial);
    for (let index = 0; index < 3; index += 1) stepMatch(server, 100);
    for (let index = 0; index < 4; index += 1) stepMatch(client, 100);

    const serverStateVersionBefore = server.stateVersion;
    const serverEventSequenceBefore = server.eventSequence;
    const result = executeCommand(server, 0, {
      commandId: "recruit-1",
      clientSeq: 1,
      expectedStateVersion: serverStateVersionBefore,
      command: { type: "RECRUIT" },
    });
    expect(result.ok).toBe(true);

    const payload: AppliedCommandPayload = {
      slot: 0,
      commandId: "recruit-1",
      clientSeq: 1,
      command: { type: "RECRUIT" },
      serverTick: server.tick,
      serverStateVersionBefore,
      serverStateVersion: result.stateVersion,
      serverEventSequenceBefore,
    };
    const replayed = replayAuthoritativeCommand(client, payload);

    expect(replayed).not.toBeNull();
    expect(replayed!.players[0].reserve).toEqual(server.players[0].reserve);
    expect(replayed!.players[0].recruitPool).toEqual(server.players[0].recruitPool);
    expect(replayed!.players[0].buns).toBe(server.players[0].buns);
    expect(replayed!.tick).toBe(client.tick);
    expect(replayed!.stateVersion).toBe(client.stateVersion + 1);
  });

  it("requests a resync instead of blocking on an unbounded background catch-up", () => {
    const client = createMatch("BACKGROUND", 0x110);
    const payload: AppliedCommandPayload = {
      slot: 0,
      commandId: "late-command",
      clientSeq: 1,
      command: { type: "RECRUIT" },
      serverTick: 1_000,
      serverStateVersionBefore: 1_000,
      serverStateVersion: 1_001,
      serverEventSequenceBefore: 0,
    };

    expect(replayAuthoritativeCommand(client, payload)).toBeNull();
  });
});
