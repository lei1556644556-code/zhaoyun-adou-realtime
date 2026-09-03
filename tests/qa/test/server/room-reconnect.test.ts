import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { GAME_CONFIG, type MatchSnapshot } from "@adou/shared";
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

function waitForEvent<T>(socket: Socket, event: string, predicate: (value: T) => boolean = () => true) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`${event} timeout`)); }, 4_000);
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
      const [started, firstHostState, firstGuestState] = await Promise.all([hostStart, hostSnapshot, guestSnapshot]);
      expect(firstHostState.seed).toBe(started.seed);
      expect(firstGuestState.seed).toBe(started.seed);
      expect(firstGuestState.players).toEqual(firstHostState.players);
      expect(firstGuestState.players.map((player) => player.introRound)).toEqual([0, 5]);

      let latestGuestState = firstGuestState;
      guest.on("match:snapshot", (snapshot: MatchSnapshot) => { latestGuestState = snapshot; });
      const recruited = waitForEvent<MatchSnapshot>(guest, "match:snapshot", (snapshot) => snapshot.players[1].recruitCount === 1);
      const envelope = {
        commandId: "qa-command-1", clientSeq: 1, expectedStateVersion: firstGuestState.stateVersion,
        command: { type: "RECRUIT" as const },
      };
      const commandResult = await emitAck<{ ok: boolean }>(guest, "match:command", envelope);
      expect(commandResult.ok).toBe(true);
      const recruitedState = await recruited;
      expect(recruitedState.acceptedCommands).toEqual({});
      expect(recruitedState.combatEvents).toEqual([]);
      expect(recruitedState.players[1].buns).toBe(GAME_CONFIG.startBuns - GAME_CONFIG.recruitBase);
      expect(recruitedState.players[1].reserve).toHaveLength(GAME_CONFIG.reserveSize);

      const duplicate = await emitAck<{ ok: boolean; duplicate: boolean }>(guest, "match:command", envelope);
      expect(duplicate).toMatchObject({ ok: true, duplicate: true });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(latestGuestState.players[1].recruitCount).toBe(1);

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
});
