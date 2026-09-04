import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import {
  GAME_CONFIG, cloneSnapshot, executeCommand,
  type AppliedCommandPayload, type MatchSnapshot,
} from "@adou/shared";
import { repositoryRoot } from "../helpers/contracts";

let serverProcess: ChildProcess | undefined;
let port = 0;

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch { /* server still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Realtime server did not become healthy");
}

function connect() {
  return io(`http://127.0.0.1:${port}`, { transports: ["websocket"], forceNew: true, reconnection: false });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timeout`)), 4_000);
    socket.emit(event, payload, (value: T) => { clearTimeout(timer); resolve(value); });
  });
}

function waitForEvent<T>(
  socket: Socket,
  event: string,
  predicate: (value: T) => boolean = () => true,
  timeoutMs = 4_000,
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`${event} timeout`)); }, timeoutMs);
    const listener = (value: T) => {
      if (!predicate(value)) return;
      clearTimeout(timer); socket.off(event, listener); resolve(value);
    };
    socket.on(event, listener);
  });
}

beforeAll(async () => {
  port = await freePort();
  const serverRoot = path.join(repositoryRoot, "apps/server");
  const tsxCli = path.join(serverRoot, "node_modules/tsx/dist/cli.mjs");
  serverProcess = spawn(process.execPath, [tsxCli, "src/index.ts"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: "http://127.0.0.1:5173" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
}, 15_000);

afterAll(() => serverProcess?.kill());

describe("two-client authoritative room transport", () => {
  it("puts simultaneous quick-match requests into the same room", async () => {
    const first = connect();
    const second = connect();
    const sockets = [first, second];
    try {
      await Promise.all(sockets.map((socket) => waitForEvent(socket, "connect")));
      const [firstJoin, secondJoin] = await Promise.all([
        emitAck<{ ok: boolean; roomId: string; slot: number }>(first, "room:quick", { name: "甲" }),
        emitAck<{ ok: boolean; roomId: string; slot: number }>(second, "room:quick", { name: "乙" }),
      ]);

      expect(firstJoin).toMatchObject({ ok: true, slot: 0 });
      expect(secondJoin).toMatchObject({ ok: true, roomId: firstJoin.roomId, slot: 1 });
      const firstStart = waitForEvent<{ roomId: string; seed: number }>(first, "match:start");
      const secondStart = waitForEvent<{ roomId: string; seed: number }>(second, "match:start");
      const firstReady = await emitAck<{ ok: boolean; ready: boolean; started: boolean }>(first, "room:ready", {});
      expect(firstReady).toEqual({ ok: true, ready: true, started: false });
      const secondReady = await emitAck<{ ok: boolean; ready: boolean; started: boolean }>(second, "room:ready", {});
      expect(secondReady).toEqual({ ok: true, ready: true, started: true });
      expect((await firstStart).roomId).toBe(firstJoin.roomId);
      expect((await secondStart).roomId).toBe(firstJoin.roomId);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
    }
  });

  it("clears a pre-match ready flag on disconnect and still waits for both players", async () => {
    const host = connect();
    const guest = connect();
    const sockets = [host, guest];
    try {
      await Promise.all(sockets.map((socket) => waitForEvent(socket, "connect")));
      const hostJoin = await emitAck<{ ok: boolean; roomId: string; slot: number; token: string }>(host, "room:create", { name: "主公" });
      const guestJoin = await emitAck<{ ok: boolean; roomId: string; slot: number; token: string }>(guest, "room:join", {
        roomId: hostJoin.roomId, name: "援军",
      });
      expect(guestJoin).toMatchObject({ ok: true, slot: 1 });
      expect(await emitAck(host, "room:ready", {})).toMatchObject({ ok: true, started: false });

      const hostOffline = waitForEvent<{ players: Array<{ slot: number; connected: boolean; ready: boolean }> }>(
        guest, "room:status", (status) => status.players.some((player) => player.slot === 0 && !player.connected && !player.ready),
      );
      host.disconnect();
      await hostOffline;

      const resumedHost = connect();
      sockets.push(resumedHost);
      await waitForEvent(resumedHost, "connect");
      expect(await emitAck(resumedHost, "room:resume", { roomId: hostJoin.roomId, token: hostJoin.token }))
        .toMatchObject({ ok: true, slot: 0 });
      expect(await emitAck(guest, "room:ready", {})).toMatchObject({ ok: true, started: false });
      const hostStart = waitForEvent<{ roomId: string }>(resumedHost, "match:start");
      const guestStart = waitForEvent<{ roomId: string }>(guest, "match:start");
      expect(await emitAck(resumedHost, "room:ready", {})).toMatchObject({ ok: true, started: true });
      expect((await hostStart).roomId).toBe(hostJoin.roomId);
      expect((await guestStart).roomId).toBe(hostJoin.roomId);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
    }
  });

  it("synchronizes commands, deduplicates them, and resumes a disconnected seat", async () => {
    const host = connect();
    const guest = connect();
    const sockets = [host, guest];
    try {
      await Promise.all(sockets.map((socket) => waitForEvent(socket, "connect")));
      const hostJoin = await emitAck<{ ok: boolean; roomId: string; slot: number; token: string }>(host, "room:create", { name: "主公", introRound: 0 });
      expect(hostJoin).toMatchObject({ ok: true, slot: 0 });

      const hostStart = waitForEvent<{ roomId: string; seed: number }>(host, "match:start");
      const hostSnapshot = waitForEvent<MatchSnapshot>(host, "match:snapshot");
      const guestSnapshot = waitForEvent<MatchSnapshot>(guest, "match:snapshot");
      const guestJoin = await emitAck<{ ok: boolean; roomId: string; slot: number; token: string }>(guest, "room:join", {
        roomId: hostJoin.roomId, name: "援军", introRound: 5,
      });
      expect(guestJoin).toMatchObject({ ok: true, roomId: hostJoin.roomId, slot: 1 });
      expect(await emitAck(host, "room:ready", {})).toMatchObject({ ok: true, started: false });
      expect(await emitAck(guest, "room:ready", {})).toMatchObject({ ok: true, started: true });
      const [started, firstHostState, firstGuestState] = await Promise.all([hostStart, hostSnapshot, guestSnapshot]);
      expect(firstHostState.seed).toBe(started.seed);
      expect(firstGuestState.seed).toBe(started.seed);
      expect(firstGuestState.players).toEqual(firstHostState.players);
      expect(firstGuestState.players.map((player) => player.introRound)).toEqual([0, 5]);

      let unexpectedFullSnapshots = 0;
      guest.on("match:snapshot", () => { unexpectedFullSnapshots += 1; });
      const hostApplied = waitForEvent<AppliedCommandPayload>(host, "match:command-applied");
      const guestApplied = waitForEvent<AppliedCommandPayload>(guest, "match:command-applied");
      const envelope = {
        commandId: "qa-command-1", clientSeq: 1, expectedStateVersion: firstGuestState.stateVersion,
        command: { type: "RECRUIT" as const },
      };
      const commandResult = await emitAck<{ ok: boolean }>(guest, "match:command", envelope);
      expect(commandResult.ok).toBe(true);
      const [hostCommand, guestCommand] = await Promise.all([hostApplied, guestApplied]);
      expect(guestCommand).toEqual(hostCommand);
      expect(guestCommand).toMatchObject({
        slot: 1, commandId: envelope.commandId, clientSeq: 1, command: envelope.command,
      });

      const locallyReplayed = cloneSnapshot(firstGuestState);
      expect(executeCommand(locallyReplayed, 1, {
        ...envelope, expectedStateVersion: locallyReplayed.stateVersion,
      }).ok).toBe(true);
      expect(locallyReplayed.players[1].buns).toBe(GAME_CONFIG.startBuns - GAME_CONFIG.recruitBase);
      expect(locallyReplayed.players[1].reserve).toHaveLength(GAME_CONFIG.reserveSize);
      expect(unexpectedFullSnapshots).toBe(0);

      let duplicateBroadcasts = 0;
      guest.on("match:command-applied", () => { duplicateBroadcasts += 1; });
      const duplicate = await emitAck<{ ok: boolean; duplicate: boolean }>(guest, "match:command", envelope);
      expect(duplicate).toMatchObject({ ok: true, duplicate: true });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(duplicateBroadcasts).toBe(0);

      const corrected = waitForEvent<MatchSnapshot>(guest, "match:snapshot");
      expect(await emitAck(guest, "match:resync", {})).toMatchObject({ ok: true });
      const correctedState = await corrected;
      expect(correctedState.acceptedCommands).toEqual({});
      expect(correctedState.combatEvents).toEqual([]);
      expect(correctedState.players[1].recruitCount).toBe(1);

      const disconnected = waitForEvent<{ players: Array<{ slot: number; connected: boolean }> }>(
        host, "room:status", (status) => status.players.some((player) => player.slot === 1 && !player.connected),
      );
      guest.disconnect();
      await disconnected;

      const resumedGuest = connect();
      sockets.push(resumedGuest);
      await waitForEvent(resumedGuest, "connect");
      const resumedSnapshot = waitForEvent<MatchSnapshot>(resumedGuest, "match:snapshot");
      const resume = await emitAck<{ ok: boolean; roomId: string; slot: number }>(resumedGuest, "room:resume", {
        roomId: guestJoin.roomId, token: guestJoin.token,
      });
      expect(resume).toMatchObject({ ok: true, roomId: hostJoin.roomId, slot: 1 });
      expect((await resumedSnapshot).players[1].recruitCount).toBe(1);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
    }
  });

  it("advances without 10 Hz full snapshots and emits a sparse correction checkpoint", async () => {
    const host = connect();
    const guest = connect();
    const sockets = [host, guest];
    try {
      await Promise.all(sockets.map((socket) => waitForEvent(socket, "connect")));
      const joined = await emitAck<{ ok: boolean; roomId: string }>(host, "room:create", { name: "甲" });
      await emitAck(guest, "room:join", { roomId: joined.roomId, name: "乙" });
      const initialHost = waitForEvent<MatchSnapshot>(host, "match:snapshot");
      const initialGuest = waitForEvent<MatchSnapshot>(guest, "match:snapshot");
      await emitAck(host, "room:ready", {});
      await emitAck(guest, "room:ready", {});
      await Promise.all([initialHost, initialGuest]);

      let fullSnapshotCount = 0;
      host.on("match:snapshot", () => { fullSnapshotCount += 1; });
      const startedAt = Date.now();
      const checkpoint = await waitForEvent<MatchSnapshot>(host, "match:checkpoint", () => true, 6_000);
      const elapsed = Date.now() - startedAt;

      expect(checkpoint.tick).toBeGreaterThan(0);
      expect(elapsed).toBeGreaterThanOrEqual(2_300);
      expect(elapsed).toBeLessThanOrEqual(5_500);
      expect(fullSnapshotCount).toBe(0);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
    }
  }, 8_000);
});
