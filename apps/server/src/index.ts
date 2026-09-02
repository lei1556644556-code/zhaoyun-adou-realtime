import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import { Server, type Socket } from "socket.io";
import {
  GAME_CONFIG, applyCommand, cloneSnapshot, createMatch, stepMatch,
  type CommandEnvelope, type MatchSnapshot, type PlayerSlot,
} from "@adou/shared";

type Ack = (payload: Record<string, unknown>) => void;
interface Seat {
  slot: PlayerSlot;
  name: string;
  token: string;
  socketId: string | null;
  disconnectedAt?: number;
}
interface Room {
  id: string;
  seats: Seat[];
  snapshot: MatchSnapshot | null;
  commands: Set<string>;
  createdAt: number;
}

const app = express();
const httpServer = createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN ?? true;
const io = new Server(httpServer, { cors: { origin: allowedOrigin, credentials: false } });
const rooms = new Map<string, Room>();
let quickRoomId: string | null = null;

app.get("/health", (_request, response) => {
  response.json({ ok: true, rooms: rooms.size, protocol: GAME_CONFIG.protocolVersion });
});

const staticDir = path.resolve(process.cwd(), process.env.STATIC_DIR ?? "../client/dist");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(staticDir, "index.html")));
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const bytes = randomBytes(6);
    const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("").slice(0, 6);
    if (!rooms.has(code)) return code;
  }
}

function createRoom(): Room {
  const room: Room = { id: roomCode(), seats: [], snapshot: null, commands: new Set(), createdAt: Date.now() };
  rooms.set(room.id, room);
  return room;
}

function emitStatus(room: Room) {
  io.to(room.id).emit("room:status", {
    roomId: room.id,
    players: room.seats.map(({ slot, name, socketId }) => ({ slot, name, connected: Boolean(socketId) })),
    started: Boolean(room.snapshot),
  });
}

function startIfReady(room: Room) {
  if (room.seats.length !== 2 || room.snapshot) return;
  const seed = randomBytes(4).readUInt32LE(0);
  room.snapshot = createMatch(room.id, seed);
  quickRoomId = quickRoomId === room.id ? null : quickRoomId;
  io.to(room.id).emit("match:start", { roomId: room.id, seed });
  io.to(room.id).emit("match:snapshot", cloneSnapshot(room.snapshot));
  emitStatus(room);
}

function takeSeat(room: Room, socket: Socket, name: string) {
  if (room.seats.length >= 2) return null;
  const seat: Seat = {
    slot: room.seats.length as PlayerSlot,
    name: name.trim().slice(0, 16) || `玩家${room.seats.length + 1}`,
    token: randomUUID(), socketId: socket.id,
  };
  room.seats.push(seat);
  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.token = seat.token;
  emitStatus(room);
  startIfReady(room);
  return seat;
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }: { name?: string } = {}, ack?: Ack) => {
    const room = createRoom();
    const seat = takeSeat(room, socket, name ?? "主公");
    ack?.({ ok: true, roomId: room.id, slot: seat?.slot, token: seat?.token });
  });

  socket.on("room:join", ({ roomId, name }: { roomId?: string; name?: string } = {}, ack?: Ack) => {
    const room = rooms.get((roomId ?? "").toUpperCase());
    if (!room) return ack?.({ ok: false, code: "ROOM_NOT_FOUND", message: "房间不存在" });
    if (room.snapshot) return ack?.({ ok: false, code: "ROOM_STARTED", message: "房间已经开战" });
    const seat = takeSeat(room, socket, name ?? "援军");
    if (!seat) return ack?.({ ok: false, code: "ROOM_FULL", message: "房间已满" });
    ack?.({ ok: true, roomId: room.id, slot: seat.slot, token: seat.token });
  });

  socket.on("room:quick", ({ name }: { name?: string } = {}, ack?: Ack) => {
    let room = quickRoomId ? rooms.get(quickRoomId) : undefined;
    if (!room || room.seats.length >= 2 || room.snapshot) {
      room = createRoom(); quickRoomId = room.id;
    }
    const seat = takeSeat(room, socket, name ?? "侠客");
    ack?.({ ok: true, roomId: room.id, slot: seat?.slot, token: seat?.token });
  });

  socket.on("room:resume", ({ roomId, token }: { roomId?: string; token?: string } = {}, ack?: Ack) => {
    const room = rooms.get((roomId ?? "").toUpperCase());
    const seat = room?.seats.find((candidate) => candidate.token === token);
    if (!room || !seat) return ack?.({ ok: false, code: "RESUME_FAILED", message: "恢复凭证无效" });
    seat.socketId = socket.id; delete seat.disconnectedAt;
    socket.join(room.id); socket.data.roomId = room.id; socket.data.token = seat.token;
    ack?.({ ok: true, roomId: room.id, slot: seat.slot, token: seat.token });
    emitStatus(room);
    if (room.snapshot) socket.emit("match:snapshot", cloneSnapshot(room.snapshot));
  });

  socket.on("match:command", (envelope: CommandEnvelope, ack?: Ack) => {
    const room = rooms.get(socket.data.roomId as string);
    const seat = room?.seats.find((candidate) => candidate.token === socket.data.token);
    if (!room?.snapshot || !seat) return ack?.({ ok: false, code: "ERR_ROOM_STATE", message: "尚未进入战斗" });
    if (room.commands.has(envelope.commandId)) return ack?.({ ok: true, duplicate: true, stateVersion: room.snapshot.stateVersion });
    room.commands.add(envelope.commandId);
    const result = applyCommand(room.snapshot, seat.slot, envelope.command);
    result.commandId = envelope.commandId;
    ack?.(result as unknown as Record<string, unknown>);
    if (result.ok) io.to(room.id).emit("match:snapshot", cloneSnapshot(room.snapshot));
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomId as string);
    const seat = room?.seats.find((candidate) => candidate.token === socket.data.token);
    // A page refresh can establish the replacement socket before the old one
    // finishes disconnecting. Never let that stale disconnect mark the new
    // connection offline.
    if (!room || !seat || seat.socketId !== socket.id) return;
    seat.socketId = null; seat.disconnectedAt = Date.now();
    emitStatus(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.snapshot && room.snapshot.phase !== "finished") {
      stepMatch(room.snapshot, 1000 / GAME_CONFIG.tickHz);
      io.to(room.id).emit("match:snapshot", cloneSnapshot(room.snapshot));
    }
    const noConnectedPlayers = room.seats.every((seat) => !seat.socketId);
    if (noConnectedPlayers && now - room.createdAt > 10 * 60_000) rooms.delete(room.id);
  }
}, 1000 / GAME_CONFIG.tickHz);

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`赵云与阿斗 realtime server listening on http://localhost:${port}`);
});
