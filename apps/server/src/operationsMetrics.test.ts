import { describe, expect, it } from "vitest";
import type { OperationsRoomSummary } from "@adou/shared";
import { OperationsMetrics } from "./operationsMetrics";

function room(overrides: Partial<OperationsRoomSummary> = {}): OperationsRoomSummary {
  return {
    roomId: "ABC123",
    state: "waiting",
    players: [{ slot: 0, name: "玩家一", connected: true, ready: false }],
    playerCount: 1,
    connectedPlayers: 1,
    readyPlayers: 0,
    wave: null,
    ageMs: 1_000,
    simulationTimeMs: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(1_000).toISOString(),
    ...overrides,
  };
}

function state(now: number, rooms: OperationsRoomSummary[]) {
  return {
    now,
    onlineUsers: 2,
    socketConnections: 3,
    rooms,
    authenticationRequired: true,
    persistenceEnabled: true,
    protocolVersion: "0.6.0",
    rulesetVersion: "1.0.9",
  };
}

describe("OperationsMetrics", () => {
  it("classifies room states and reconciles connected seats", () => {
    const monitor = new OperationsMetrics(0);
    const snapshot = monitor.snapshot(state(1_000, [
      room(),
      room({ roomId: "DEF456", state: "ready", playerCount: 2, connectedPlayers: 1, readyPlayers: 1 }),
      room({ roomId: "GHI789", state: "battle", playerCount: 2, connectedPlayers: 2, readyPlayers: 2, wave: 8 }),
      room({ roomId: "JKL234", state: "finished", playerCount: 2, connectedPlayers: 0, readyPlayers: 2, wave: 20 }),
    ]));
    expect(snapshot.rooms).toEqual({ total: 4, waiting: 1, ready: 1, battle: 1, finished: 1 });
    expect(snapshot.seatedOnlinePlayers).toBe(4);
    expect(snapshot.disconnectedSeats).toBe(3);
    expect(snapshot.onlineUsers).toBe(2);
    expect(snapshot.roomDetails.map((item) => item.roomId)).toHaveLength(4);
    expect(snapshot.health.hostTotalBytes).toBeGreaterThan(0);
    expect(snapshot.health.hostFreeBytes).toBeGreaterThanOrEqual(0);
    expect(snapshot.health.hostFreeBytes).toBeLessThanOrEqual(snapshot.health.hostTotalBytes ?? 0);
  });

  it("computes rolling rates from monotonic counters", () => {
    const monitor = new OperationsMetrics(0);
    monitor.snapshot(state(1_000, []));
    for (let index = 0; index < 4; index += 1) monitor.recordCommand(true);
    for (let index = 0; index < 2; index += 1) monitor.recordCommand(false);
    monitor.increment("resyncRequests", 3);
    monitor.recordOutbound("match:checkpoint", { value: "1234567890" }, 2);
    const snapshot = monitor.snapshot(state(61_000, []));
    expect(snapshot.traffic.commandsPerMinute).toBe(6);
    expect(snapshot.traffic.rejectedCommandsPerMinute).toBe(2);
    expect(snapshot.traffic.commandRejectRate).toBeCloseTo(1 / 3);
    expect(snapshot.traffic.resyncsPerMinute).toBe(3);
    expect(snapshot.traffic.checkpointsPerMinute).toBe(2);
    expect(snapshot.traffic.estimatedOutboundBytesPerMinute).toBeGreaterThan(0);
  });

  it("tracks stream clients without allowing a negative count", () => {
    const monitor = new OperationsMetrics(0);
    monitor.streamOpened();
    monitor.streamOpened();
    monitor.streamClosed();
    monitor.streamClosed();
    monitor.streamClosed();
    expect(monitor.snapshot(state(1_000, [])).health.adminStreamClients).toBe(0);
  });
});
