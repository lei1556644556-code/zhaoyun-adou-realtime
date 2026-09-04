import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { Server, type Socket } from "socket.io";
import {
  GAME_CONFIG, MATCH_SNAPSHOT_VERSION, RULESET_VERSION, RULES_CONFIG_SCHEMA_VERSION,
  cloneSnapshot, createMatch, executeCommand, stepMatch,
  type CommandEnvelope, type MatchSnapshot, type PlayerSlot,
} from "@adou/shared";

type Ack = (payload: Record<string, unknown>) => void;
interface Seat {
  slot: PlayerSlot;
  userId: string;
  name: string;
  ready: boolean;
  tokenHash: string;
  socketId: string | null;
  introRound: number;
  disconnectedAt?: number;
}
interface Room {
  id: string;
  seats: Seat[];
  snapshot: MatchSnapshot | null;
  createdAt: number;
  updatedAt: number;
  lastCheckpointAt: number;
  persistInFlight: Promise<void> | null;
  persistRequested: boolean;
}
interface StoredRoomRow {
  room_id: string;
  seats: Array<Omit<Seat, "socketId" | "disconnectedAt">>;
  snapshot: MatchSnapshot | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

const MATCH_TABLE = "zhaoyun_adou_matches";
const isProduction = process.env.NODE_ENV === "production";
const requireAuth = process.env.REQUIRE_AUTH === "true" || isProduction;
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const originList = (process.env.CLIENT_ORIGIN ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const socketPath = process.env.SOCKET_PATH?.trim() || "/socket.io";
const host = process.env.HOST?.trim() || "127.0.0.1";

if (requireAuth && (!supabaseUrl || !publishableKey)) {
  throw new Error("Production authority requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY");
}
if (isProduction && !serviceRoleKey) {
  throw new Error("Production authority requires SUPABASE_SERVICE_ROLE_KEY for checkpoints");
}
if (isProduction && originList.length === 0) {
  throw new Error("Production authority requires an exact CLIENT_ORIGIN allowlist");
}

const authClient = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const adminClient = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  path: socketPath,
  cors: { origin: originList.length > 0 ? originList : true, credentials: false },
});
const rooms = new Map<string, Room>();
let quickRoomId: string | null = null;
let quickSeatQueue: Promise<void> = Promise.resolve();

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    rooms: rooms.size,
    protocol: GAME_CONFIG.protocolVersion,
    ruleset: RULESET_VERSION,
    authority: "server",
    authentication: requireAuth,
    persistence: Boolean(adminClient),
  });
});

const staticDir = path.resolve(process.cwd(), process.env.STATIC_DIR ?? "../client/dist");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(staticDir, "index.html")));
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cleanName(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 16) : fallback;
}

function newRoom(code: string): Room {
  const now = Date.now();
  return {
    id: code, seats: [], snapshot: null, createdAt: now, updatedAt: now,
    lastCheckpointAt: 0, persistInFlight: null, persistRequested: false,
  };
}

async function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const bytes = randomBytes(6);
    const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("").slice(0, 6);
    if (rooms.has(code)) continue;
    if (!adminClient) return code;
    const { data, error } = await adminClient.from(MATCH_TABLE).select("room_id").eq("room_id", code).maybeSingle();
    if (error) throw new Error(`Match room lookup failed: ${error.message}`);
    if (!data) return code;
  }
}

async function createRoom() {
  const room = newRoom(await roomCode());
  rooms.set(room.id, room);
  return room;
}

function serializeRoom(room: Room): StoredRoomRow {
  const now = new Date();
  return {
    room_id: room.id,
    seats: room.seats.map(({ slot, userId, name, ready, tokenHash: hash, introRound }) => ({
      slot, userId, name, ready, tokenHash: hash, introRound,
    })),
    // Supabase is a recovery checkpoint, not an append-only event log. The
    // command retry ledger and duplicate combat view are transient and would
    // otherwise make every later checkpoint progressively larger.
    snapshot: room.snapshot ? snapshotWithoutTransientHistory(room.snapshot) : null,
    created_at: new Date(room.createdAt).toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
  };
}

/**
 * Clients render authoritative state but never need the server's idempotency
 * ledger or the deprecated duplicate attack-event view. Keeping those fields
 * out of the 10 Hz wire payload prevents command history and combat effects
 * from multiplying bandwidth as a match progresses.
 */
function snapshotWithoutTransientHistory(snapshot: MatchSnapshot) {
  const wire = cloneSnapshot(snapshot);
  wire.acceptedCommands = {};
  wire.combatEvents = [];
  return wire;
}

const snapshotForClient = snapshotWithoutTransientHistory;

function persistRoom(room: Room) {
  if (!adminClient) return Promise.resolve();
  room.persistRequested = true;
  if (room.persistInFlight) return room.persistInFlight;
  const operation = (async () => {
    while (room.persistRequested) {
      room.persistRequested = false;
      const row = serializeRoom(room);
      const { error } = await adminClient.from(MATCH_TABLE).upsert(row, { onConflict: "room_id" });
      if (error) throw new Error(`Match checkpoint failed: ${error.message}`);
      room.lastCheckpointAt = Date.now();
    }
  })();
  room.persistInFlight = operation;
  void operation.catch((error: unknown) => {
    console.error(JSON.stringify({ event: "checkpoint_failed", roomId: room.id, message: error instanceof Error ? error.message : String(error) }));
  }).finally(() => {
    room.persistInFlight = null;
    if (room.persistRequested) void persistRoom(room).catch(() => undefined);
  });
  return operation;
}

async function loadRoom(roomId: string) {
  const normalized = roomId.toUpperCase();
  const cached = rooms.get(normalized);
  if (cached || !adminClient) return cached;
  const { data, error } = await adminClient.from(MATCH_TABLE)
    .select("room_id,seats,snapshot,created_at,updated_at,expires_at")
    .eq("room_id", normalized).gt("expires_at", new Date().toISOString()).maybeSingle<StoredRoomRow>();
  if (error) throw new Error(`Match restore failed: ${error.message}`);
  if (!data) return undefined;
  const room: Room = {
    id: data.room_id,
    seats: data.seats.map((seat) => ({ ...seat, ready: Boolean(seat.ready), socketId: null })),
    snapshot: data.snapshot ? cloneSnapshot(data.snapshot) : null,
    createdAt: Date.parse(data.created_at), updatedAt: Date.parse(data.updated_at),
    lastCheckpointAt: Date.now(), persistInFlight: null, persistRequested: false,
  };
  rooms.set(room.id, room);
  return room;
}

function emitStatus(room: Room) {
  io.to(room.id).emit("room:status", {
    roomId: room.id,
    players: room.seats.map(({ slot, name, ready, socketId }) => ({ slot, name, ready, connected: Boolean(socketId) })),
    started: Boolean(room.snapshot),
  });
}

function startIfReady(room: Room) {
  if (room.seats.length !== 2 || room.snapshot
    || room.seats.some((seat) => !seat.socketId || !seat.ready)) return;
  const seed = randomBytes(4).readUInt32LE(0);
  room.snapshot = createMatch(room.id, seed, 0, [room.seats[0]!.introRound, room.seats[1]!.introRound]);
  room.updatedAt = Date.now();
  quickRoomId = quickRoomId === room.id ? null : quickRoomId;
  io.to(room.id).emit("match:start", { roomId: room.id, seed });
  io.to(room.id).emit("match:snapshot", snapshotForClient(room.snapshot));
  emitStatus(room);
}

function takeSeat(room: Room, socket: Socket, requestedName: unknown, guestIntroRound = 10) {
  if (room.seats.length >= 2) return { error: "ROOM_FULL" as const };
  const userId = String(socket.data.userId);
  if (room.seats.some((seat) => seat.userId === userId)) return { error: "ALREADY_SEATED" as const };
  const token = randomUUID();
  const slot = room.seats.length as PlayerSlot;
  const authenticated = socket.data.authenticated === true;
  const seat: Seat = {
    slot,
    userId,
    name: authenticated ? cleanName(socket.data.displayName, `玩家${slot + 1}`) : cleanName(requestedName, `玩家${slot + 1}`),
    ready: false,
    tokenHash: tokenHash(token), socketId: socket.id,
    introRound: authenticated ? Math.max(0, Math.floor(Number(socket.data.introRound) || 0)) : Math.max(0, Math.floor(guestIntroRound)),
  };
  room.seats.push(seat);
  room.updatedAt = Date.now();
  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.slot = seat.slot;
  emitStatus(room);
  return { seat, token };
}

async function takeQuickSeat(socket: Socket, requestedName: unknown, guestIntroRound = 10) {
  const previous = quickSeatQueue;
  let release!: () => void;
  quickSeatQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    let room = quickRoomId ? rooms.get(quickRoomId) : undefined;
    if (!room || room.seats.length >= 2 || room.snapshot) {
      room = await createRoom();
      quickRoomId = room.id;
    }
    return { room, joined: takeSeat(room, socket, requestedName, guestIntroRound) };
  } finally {
    release();
  }
}

function compatibleHandshake(socket: Socket) {
  if (!requireAuth) return true;
  const auth = socket.handshake.auth as Record<string, unknown>;
  return auth.protocolVersion === GAME_CONFIG.protocolVersion
    && auth.rulesetVersion === RULESET_VERSION
    && auth.rulesSchemaVersion === RULES_CONFIG_SCHEMA_VERSION
    && auth.snapshotVersion === MATCH_SNAPSHOT_VERSION;
}

io.use(async (socket, next) => {
  try {
    if (!compatibleHandshake(socket)) return next(new Error("客户端规则或协议版本不兼容，请刷新页面"));
    if (!requireAuth) {
      socket.data.userId = `guest:${socket.id}`;
      socket.data.displayName = "测试玩家";
      socket.data.introRound = 0;
      socket.data.authenticated = false;
      return next();
    }
    const accessToken = String(socket.handshake.auth.accessToken ?? "");
    if (!accessToken || !authClient || !supabaseUrl || !publishableKey) return next(new Error("缺少登录凭证"));
    const { data, error } = await authClient.auth.getUser(accessToken);
    if (error || !data.user) return next(new Error("登录凭证无效或已过期"));
    const scoped = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await scoped.from("zhaoyun_adou_profiles")
      .select("display_name,progress").eq("user_id", data.user.id).maybeSingle();
    if (profileError) return next(new Error("无法读取账号对局进度"));
    const progress = profile?.progress as { economy?: { totalMatches?: number } } | null;
    socket.data.userId = data.user.id;
    socket.data.displayName = profile?.display_name ?? data.user.user_metadata.username ?? "玩家";
    socket.data.introRound = Math.max(0, Math.floor(Number(progress?.economy?.totalMatches) || 0));
    socket.data.authenticated = true;
    return next();
  } catch (error) {
    return next(error instanceof Error ? error : new Error("账号验证失败"));
  }
});

io.on("connection", (socket) => {
  socket.on("room:create", async ({ name, introRound }: { name?: string; introRound?: number } = {}, ack?: Ack) => {
    try {
      const room = await createRoom();
      const joined = takeSeat(room, socket, name, introRound);
      if ("error" in joined) return ack?.({ ok: false, code: joined.error, message: "无法创建房间" });
      await persistRoom(room);
      ack?.({ ok: true, roomId: room.id, slot: joined.seat.slot, token: joined.token });
    } catch (error) { ack?.({ ok: false, code: "SERVER_ERROR", message: error instanceof Error ? error.message : "创建房间失败" }); }
  });

  socket.on("room:join", async ({ roomId, name, introRound }: { roomId?: string; name?: string; introRound?: number } = {}, ack?: Ack) => {
    try {
      const room = await loadRoom(roomId ?? "");
      if (!room) return ack?.({ ok: false, code: "ROOM_NOT_FOUND", message: "房间不存在" });
      if (room.snapshot) return ack?.({ ok: false, code: "ROOM_STARTED", message: "房间已经开战" });
      const joined = takeSeat(room, socket, name, introRound);
      if ("error" in joined) return ack?.({
        ok: false, code: joined.error,
        message: joined.error === "ALREADY_SEATED" ? "该账号已经在房间中，请使用恢复连接" : "房间已满",
      });
      await persistRoom(room);
      ack?.({ ok: true, roomId: room.id, slot: joined.seat.slot, token: joined.token });
    } catch (error) { ack?.({ ok: false, code: "SERVER_ERROR", message: error instanceof Error ? error.message : "加入房间失败" }); }
  });

  socket.on("room:quick", async ({ name, introRound }: { name?: string; introRound?: number } = {}, ack?: Ack) => {
    try {
      const { room, joined } = await takeQuickSeat(socket, name, introRound);
      if ("error" in joined) return ack?.({ ok: false, code: joined.error, message: "随机匹配失败" });
      await persistRoom(room);
      ack?.({ ok: true, roomId: room.id, slot: joined.seat.slot, token: joined.token });
    } catch (error) { ack?.({ ok: false, code: "SERVER_ERROR", message: error instanceof Error ? error.message : "随机匹配失败" }); }
  });

  socket.on("room:resume", async ({ roomId, token }: { roomId?: string; token?: string } = {}, ack?: Ack) => {
    try {
      const room = await loadRoom(roomId ?? "");
      const hash = tokenHash(token ?? "");
      const seat = room?.seats.find((candidate) => candidate.tokenHash === hash
        && (!requireAuth || candidate.userId === socket.data.userId));
      if (!room || !seat) return ack?.({ ok: false, code: "RESUME_FAILED", message: "恢复凭证无效" });
      seat.socketId = socket.id; delete seat.disconnectedAt;
      if (!requireAuth) seat.userId = String(socket.data.userId);
      room.updatedAt = Date.now();
      socket.join(room.id); socket.data.roomId = room.id; socket.data.slot = seat.slot;
      ack?.({ ok: true, roomId: room.id, slot: seat.slot, token });
      emitStatus(room);
      if (room.snapshot) socket.emit("match:snapshot", snapshotForClient(room.snapshot));
      await persistRoom(room);
    } catch (error) { ack?.({ ok: false, code: "SERVER_ERROR", message: error instanceof Error ? error.message : "恢复房间失败" }); }
  });

  socket.on("room:ready", async (_payload: Record<string, never> = {}, ack?: Ack) => {
    try {
      const room = rooms.get(String(socket.data.roomId));
      const seat = room?.seats.find((candidate) => candidate.slot === socket.data.slot && candidate.userId === socket.data.userId);
      if (!room || !seat) return ack?.({ ok: false, code: "ROOM_NOT_JOINED", message: "尚未进入房间" });
      if (room.snapshot) return ack?.({ ok: true, ready: true, started: true });
      seat.ready = true;
      room.updatedAt = Date.now();
      emitStatus(room);
      startIfReady(room);
      await persistRoom(room);
      ack?.({ ok: true, ready: true, started: Boolean(room.snapshot) });
    } catch (error) {
      ack?.({ ok: false, code: "SERVER_ERROR", message: error instanceof Error ? error.message : "准备状态提交失败" });
    }
  });

  socket.on("match:command", async (envelope: CommandEnvelope, ack?: Ack) => {
    try {
      const room = rooms.get(String(socket.data.roomId));
      const seat = room?.seats.find((candidate) => candidate.slot === socket.data.slot && candidate.userId === socket.data.userId);
      if (!room?.snapshot || !seat) return ack?.({ ok: false, code: "ERR_ROOM_STATE", message: "尚未进入战斗" });
      const accepted = room.snapshot.acceptedCommands[envelope.commandId];
      const result = executeCommand(room.snapshot, seat.slot, {
        ...envelope,
        expectedStateVersion: accepted?.expectedStateVersion ?? room.snapshot.stateVersion,
      });
      ack?.(result as unknown as Record<string, unknown>);
      if (result.ok) {
        room.updatedAt = Date.now();
        io.to(room.id).emit("match:snapshot", snapshotForClient(room.snapshot));
        void persistRoom(room).catch(() => undefined);
      }
    } catch (error) {
      ack?.({
        ok: false,
        code: "ERR_PERSISTENCE",
        message: error instanceof Error ? error.message : "服务器暂时无法保存操作，请重试",
      });
    }
  });

  socket.on("disconnect", () => {
    const room = rooms.get(String(socket.data.roomId));
    const seat = room?.seats.find((candidate) => candidate.slot === socket.data.slot && candidate.userId === socket.data.userId);
    if (!room || !seat || seat.socketId !== socket.id) return;
    seat.socketId = null;
    if (!room.snapshot) seat.ready = false;
    seat.disconnectedAt = Date.now(); room.updatedAt = Date.now();
    emitStatus(room);
    void persistRoom(room).catch(() => undefined);
  });
});

const tickMs = 1000 / GAME_CONFIG.tickHz;
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.snapshot && room.snapshot.phase !== "finished") {
      stepMatch(room.snapshot, tickMs);
      room.updatedAt = now;
      // Tick snapshots are replaceable state frames. If a connection is
      // congested, dropping an obsolete intermediate frame is preferable to
      // building an ever-growing reliable send queue behind the newest state.
      io.to(room.id).volatile.emit("match:snapshot", snapshotForClient(room.snapshot));
      if (!room.persistInFlight && now - room.lastCheckpointAt >= 1_000) void persistRoom(room).catch(() => undefined);
    }
    const noConnectedPlayers = room.seats.every((seat) => !seat.socketId);
    if (noConnectedPlayers && now - room.updatedAt > 10 * 60_000) rooms.delete(room.id);
  }
}, tickMs);

async function shutdown(signal: string) {
  console.log(JSON.stringify({ event: "shutdown", signal, rooms: rooms.size }));
  await Promise.all([...rooms.values()].map((room) => persistRoom(room).catch(() => undefined)));
  io.close(() => httpServer.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 8_000).unref();
}
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, host, () => {
  console.log(JSON.stringify({
    event: "server_started", host, port, protocol: GAME_CONFIG.protocolVersion,
    auth: requireAuth, persistence: Boolean(adminClient),
  }));
});
