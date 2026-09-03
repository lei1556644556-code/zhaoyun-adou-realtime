import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import {
  GAME_CONFIG, applyCommand, cloneSnapshot, createMatch, stepMatch,
  type CommandEnvelope, type MatchSnapshot, type PlayerSlot,
} from "@adou/shared";

const ROOM_PREFIX = "adou-room-v1-";
const QUICK_CHANNEL = "adou-matchmaking-v1";

type JoinedPayload = { ok: boolean; roomId?: string; slot?: PlayerSlot; token?: string; message?: string };
type PlayerSummary = { slot: PlayerSlot; name: string; connected: boolean };
type Role = "host" | "guest";
type SavedSession = {
  roomId: string;
  token: string;
  role: Role;
  name: string;
  guestName?: string;
  guestToken?: string;
  snapshot?: MatchSnapshot;
};
type WireMessage =
  | { type: "join"; requestId: string; clientId: string; name: string; resumeToken?: string }
  | { type: "join-ack"; requestId: string; targetId: string; result: JoinedPayload }
  | { type: "room-status"; players: PlayerSummary[]; started: boolean }
  | { type: "match-start"; roomId: string; seed: number }
  | { type: "snapshot"; snapshot: MatchSnapshot }
  | { type: "command"; clientId: string; token: string; envelope: CommandEnvelope }
  | { type: "command-result"; targetId: string; ok: boolean; message?: string; stateVersion: number };
type QuickMessage =
  | { type: "quick-find"; clientId: string; name: string }
  | { type: "quick-match"; targetId: string; roomId: string };

function cleanName(name: string) {
  return name.trim().slice(0, 16) || "常山侠客";
}

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export class RealtimeClient extends EventTarget {
  private readonly client: SupabaseClient;
  private readonly clientId = crypto.randomUUID();
  private readonly storageKey: string;
  private readonly intentionalClosures = new WeakSet<RealtimeChannel>();
  private roomChannel: RealtimeChannel | null = null;
  private quickChannel: RealtimeChannel | null = null;
  private tickTimer = 0;
  private quickTimer = 0;
  private quickTimeout = 0;
  private lastTickAt = 0;
  private tickRemainder = 0;
  private lastPersistAt = 0;
  private role: Role | null = null;
  private hostName = "";
  private guestName = "";
  private guestToken = "";
  private snapshot: MatchSnapshot | null = null;
  private pendingJoin: { requestId: string; resolve: (result: JoinedPayload) => void; timer: number } | null = null;
  private pendingQuick: { name: string; matching: boolean; resolve: (result: JoinedPayload) => void } | null = null;
  private seq = 0;
  private lastSendFailureAt = 0;

  slot: PlayerSlot = 0;
  roomId = "";
  token = "";
  stateVersion = 0;

  constructor(storageKey: string, connection: { url: string; publishableKey: string }) {
    super();
    this.storageKey = storageKey;
    this.client = createClient(connection.url, connection.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private async subscribe(channel: RealtimeChannel) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("实时服务连接超时"));
      }, 8_000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.emit("network", { connected: true });
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            resolve();
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.emit("network", { connected: false });
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            reject(new Error("实时服务暂时不可用"));
          }
        } else if (status === "CLOSED") {
          if (!this.intentionalClosures.has(channel)) this.emit("network", { connected: false });
        }
      });
    });
  }

  private async broadcast(channel: RealtimeChannel, message: WireMessage | QuickMessage) {
    const result = await channel.send({ type: "broadcast", event: "message", payload: message });
    if (result !== "ok") throw new Error("实时消息发送失败");
  }

  private runInBackground(task: Promise<unknown>, message = "实时同步暂时中断，请检查网络") {
    void task.catch(() => {
      const now = Date.now();
      if (now - this.lastSendFailureAt < 3_000) return;
      this.lastSendFailureAt = now;
      this.emit("network", { connected: false });
      this.emit("notice", { message });
    });
  }

  private async disconnectRoom() {
    window.clearInterval(this.tickTimer);
    this.tickTimer = 0;
    if (this.roomChannel) {
      const channel = this.roomChannel;
      this.roomChannel = null;
      this.intentionalClosures.add(channel);
      await this.client.removeChannel(channel);
    }
  }

  private clearQuickTimers() {
    window.clearInterval(this.quickTimer);
    window.clearTimeout(this.quickTimeout);
    this.quickTimer = 0;
    this.quickTimeout = 0;
  }

  private finishQuick(result: JoinedPayload) {
    const pending = this.pendingQuick;
    if (!pending) return;
    this.pendingQuick = null;
    this.clearQuickTimers();
    const channel = this.quickChannel;
    this.quickChannel = null;
    if (channel) {
      this.intentionalClosures.add(channel);
      void this.client.removeChannel(channel);
    }
    pending.resolve(result);
  }

  private readSavedSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) ?? "null") as SavedSession | null;
      return saved?.roomId && saved.token && saved.role && saved.name ? saved : null;
    } catch {
      return null;
    }
  }

  private persistSession() {
    if (!this.role || !this.roomId || !this.token) return;
    const saved: SavedSession = {
      roomId: this.roomId,
      token: this.token,
      role: this.role,
      name: this.role === "host" ? this.hostName : this.guestName,
      ...(this.role === "host" && this.guestName ? { guestName: this.guestName, guestToken: this.guestToken } : {}),
      ...(this.role === "host" && this.snapshot ? { snapshot: this.snapshot } : {}),
    };
    localStorage.setItem(this.storageKey, JSON.stringify(saved));
  }

  private players(): PlayerSummary[] {
    const players: PlayerSummary[] = [{ slot: 0, name: this.hostName || "房主", connected: true }];
    if (this.guestName) players.push({ slot: 1, name: this.guestName, connected: true });
    return players;
  }

  private publishRoomStatus() {
    const players = this.players();
    this.emit("room", { roomId: this.roomId, players, started: Boolean(this.snapshot) });
    if (this.role === "host" && this.roomChannel) {
      this.runInBackground(this.broadcast(this.roomChannel, { type: "room-status", players, started: Boolean(this.snapshot) }));
    }
  }

  private publishSnapshot() {
    if (!this.snapshot) return;
    const snapshot = cloneSnapshot(this.snapshot);
    this.stateVersion = snapshot.stateVersion;
    this.emit("snapshot", snapshot);
    if (this.role === "host" && this.roomChannel) {
      this.runInBackground(this.broadcast(this.roomChannel, { type: "snapshot", snapshot }));
    }
  }

  private startTicking() {
    if (this.role !== "host" || !this.snapshot || this.tickTimer) return;
    this.lastTickAt = performance.now();
    this.tickRemainder = 0;
    const tickMs = 1000 / GAME_CONFIG.tickHz;
    this.tickTimer = window.setInterval(() => {
      if (!this.snapshot || this.snapshot.phase === "finished") {
        window.clearInterval(this.tickTimer);
        this.tickTimer = 0;
        return;
      }
      const now = performance.now();
      const elapsed = Math.min(500, now - this.lastTickAt);
      this.lastTickAt = now;
      this.tickRemainder += elapsed;
      const steps = Math.floor(this.tickRemainder / tickMs);
      if (steps < 1) return;
      this.tickRemainder -= steps * tickMs;
      for (let index = 0; index < steps; index += 1) stepMatch(this.snapshot, tickMs);
      this.publishSnapshot();
      if (Date.now() - this.lastPersistAt >= 1_000) {
        this.lastPersistAt = Date.now();
        this.persistSession();
      }
    }, tickMs);
  }

  private async connectRoom(roomId: string) {
    await this.disconnectRoom();
    this.roomId = roomId.toUpperCase();
    const channel = this.client.channel(`${ROOM_PREFIX}${this.roomId}`, {
      config: { broadcast: { self: false, ack: true } },
    });
    channel.on("broadcast", { event: "message" }, ({ payload }) => this.onRoomMessage(payload));
    this.roomChannel = channel;
    await this.subscribe(channel);
  }

  private async becomeHost(name: string, roomId = randomRoomCode()): Promise<JoinedPayload> {
    this.role = "host";
    this.slot = 0;
    this.token = crypto.randomUUID();
    this.hostName = cleanName(name);
    this.guestName = "";
    this.guestToken = "";
    this.snapshot = null;
    await this.connectRoom(roomId);
    this.persistSession();
    this.publishRoomStatus();
    return { ok: true, roomId: this.roomId, slot: this.slot, token: this.token } satisfies JoinedPayload;
  }

  private async requestJoin(roomId: string, name: string, resumeToken?: string): Promise<JoinedPayload> {
    this.role = "guest";
    this.slot = 1;
    this.guestName = cleanName(name);
    await this.connectRoom(roomId);
    const requestId = crypto.randomUUID();
    const resultPromise = new Promise<JoinedPayload>((resolve) => {
      const timer = window.setTimeout(() => {
        if (this.pendingJoin?.requestId !== requestId) return;
        this.pendingJoin = null;
        resolve({ ok: false, message: "房间不存在或房主当前离线" });
      }, 4_500);
      this.pendingJoin = { requestId, resolve, timer };
    });
    await this.broadcast(this.roomChannel!, {
      type: "join", requestId, clientId: this.clientId, name: this.guestName,
      ...(resumeToken ? { resumeToken } : {}),
    });
    const result = await resultPromise;
    if (result.ok && result.token) {
      this.token = result.token;
      this.persistSession();
    }
    return result;
  }

  private async handleJoin(message: Extract<WireMessage, { type: "join" }>) {
    if (this.role !== "host" || !this.roomChannel) return;
    let result: JoinedPayload;
    if (message.resumeToken && message.resumeToken === this.guestToken) {
      this.guestName = cleanName(message.name);
      result = { ok: true, roomId: this.roomId, slot: 1, token: this.guestToken };
    } else if (this.guestToken || this.snapshot) {
      result = { ok: false, message: "房间已满或已经开战" };
    } else {
      this.guestName = cleanName(message.name);
      this.guestToken = crypto.randomUUID();
      result = { ok: true, roomId: this.roomId, slot: 1, token: this.guestToken };
    }
    await this.broadcast(this.roomChannel, { type: "join-ack", requestId: message.requestId, targetId: message.clientId, result });
    if (!result.ok) return;
    if (!this.snapshot) {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
      this.snapshot = createMatch(this.roomId, seed);
      this.emit("start", { roomId: this.roomId, seed });
      await this.broadcast(this.roomChannel, { type: "match-start", roomId: this.roomId, seed });
      this.startTicking();
    }
    this.persistSession();
    this.publishRoomStatus();
    this.publishSnapshot();
  }

  private async handleGuestCommand(message: Extract<WireMessage, { type: "command" }>) {
    if (this.role !== "host" || !this.snapshot || !this.roomChannel || message.token !== this.guestToken) return;
    const result = applyCommand(this.snapshot, 1, message.envelope.command);
    result.commandId = message.envelope.commandId;
    await this.broadcast(this.roomChannel, {
      type: "command-result", targetId: message.clientId, ok: result.ok,
      ...(result.message ? { message: result.message } : {}), stateVersion: result.stateVersion,
    });
    if (result.ok) {
      this.persistSession();
      this.publishSnapshot();
    }
  }

  private onRoomMessage(payload: unknown) {
    if (!isRecord(payload) || typeof payload.type !== "string") return;
    if (payload.type === "join" && (
      typeof payload.requestId !== "string" || typeof payload.clientId !== "string" || typeof payload.name !== "string"
    )) return;
    if (payload.type === "join-ack" && (
      typeof payload.requestId !== "string" || typeof payload.targetId !== "string" || !isRecord(payload.result)
    )) return;
    if (payload.type === "room-status" && !Array.isArray(payload.players)) return;
    if (payload.type === "match-start" && (typeof payload.roomId !== "string" || typeof payload.seed !== "number")) return;
    if (payload.type === "snapshot" && (!isRecord(payload.snapshot) || !Array.isArray(payload.snapshot.players))) return;
    if (payload.type === "command" && (
      typeof payload.clientId !== "string" || typeof payload.token !== "string" || !isRecord(payload.envelope)
      || !isRecord(payload.envelope.command) || typeof payload.envelope.command.type !== "string"
    )) return;
    if (payload.type === "command-result" && (
      typeof payload.targetId !== "string" || typeof payload.ok !== "boolean" || typeof payload.stateVersion !== "number"
    )) return;
    const message = payload as WireMessage;
    if (message.type === "join") {
      this.runInBackground(this.handleJoin(message), "玩家加入同步失败，请重新进入房间");
    } else if (message.type === "join-ack" && message.targetId === this.clientId && this.pendingJoin?.requestId === message.requestId) {
      window.clearTimeout(this.pendingJoin.timer);
      const resolve = this.pendingJoin.resolve;
      this.pendingJoin = null;
      resolve(message.result);
    } else if (message.type === "room-status" && this.role === "guest") {
      const host = message.players.find((player) => player.slot === 0);
      if (host) this.hostName = host.name;
      this.emit("room", { roomId: this.roomId, players: message.players, started: message.started });
    } else if (message.type === "match-start" && this.role === "guest") {
      this.emit("start", { roomId: message.roomId, seed: message.seed });
    } else if (message.type === "snapshot" && this.role === "guest") {
      this.snapshot = message.snapshot;
      this.stateVersion = message.snapshot.stateVersion;
      this.emit("snapshot", cloneSnapshot(message.snapshot));
    } else if (message.type === "command" && this.role === "host") {
      this.runInBackground(this.handleGuestCommand(message), "对手操作同步失败，请检查网络");
    } else if (message.type === "command-result" && message.targetId === this.clientId && this.role === "guest") {
      this.stateVersion = message.stateVersion;
      if (!message.ok) this.emit("notice", { message: message.message ?? "操作被房主拒绝" });
    }
  }

  private onQuickMessage(payload: unknown) {
    if (!isRecord(payload) || !this.pendingQuick || typeof payload.type !== "string") return;
    if (payload.type === "quick-find" && (typeof payload.clientId !== "string" || typeof payload.name !== "string")) return;
    if (payload.type === "quick-match" && (typeof payload.targetId !== "string" || typeof payload.roomId !== "string")) return;
    const message = payload as QuickMessage;
    if (message.type === "quick-find" && message.clientId !== this.clientId && !this.pendingQuick.matching) {
      if (this.clientId.localeCompare(message.clientId) >= 0) return;
      this.pendingQuick.matching = true;
      void (async () => {
        try {
          const result = await this.becomeHost(this.pendingQuick?.name ?? "常山侠客");
          if (this.quickChannel) await this.broadcast(this.quickChannel, { type: "quick-match", targetId: message.clientId, roomId: result.roomId! });
          this.finishQuick(result);
        } catch (error) {
          this.finishQuick({ ok: false, message: error instanceof Error ? error.message : "匹配失败" });
        }
      })();
    } else if (message.type === "quick-match" && message.targetId === this.clientId && !this.pendingQuick.matching) {
      this.pendingQuick.matching = true;
      void (async () => {
        try {
          const result = await this.requestJoin(message.roomId, this.pendingQuick?.name ?? "常山侠客");
          this.finishQuick(result);
        } catch (error) {
          this.finishQuick({ ok: false, message: error instanceof Error ? error.message : "匹配失败" });
        }
      })();
    }
  }

  async create(name: string): Promise<JoinedPayload> {
    return this.becomeHost(name);
  }

  async join(roomId: string, name: string): Promise<JoinedPayload> {
    const normalized = roomId.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) return { ok: false, message: "请输入正确的6位房号" } satisfies JoinedPayload;
    return this.requestJoin(normalized, name);
  }

  async quick(name: string): Promise<JoinedPayload> {
    await this.disconnectRoom();
    const channel = this.client.channel(QUICK_CHANNEL, { config: { broadcast: { self: false, ack: true } } });
    channel.on("broadcast", { event: "message" }, ({ payload }) => this.onQuickMessage(payload));
    this.quickChannel = channel;
    await this.subscribe(channel);
    return new Promise<JoinedPayload>((resolve) => {
      this.pendingQuick = { name: cleanName(name), matching: false, resolve };
      const announce = () => {
        if (!this.quickChannel || !this.pendingQuick || this.pendingQuick.matching) return;
        this.runInBackground(
          this.broadcast(this.quickChannel, { type: "quick-find", clientId: this.clientId, name: this.pendingQuick.name }),
          "随机匹配广播失败，请稍后重试",
        );
      };
      announce();
      this.quickTimer = window.setInterval(announce, 1_200);
      this.quickTimeout = window.setTimeout(() => this.finishQuick({ ok: false, message: "暂未匹配到玩家，请稍后重试或创建房间" }), 60_000);
    });
  }

  async resume(roomId: string, token: string): Promise<JoinedPayload> {
    const saved = this.readSavedSession();
    if (!saved || saved.roomId !== roomId || saved.token !== token) return { ok: false, message: "没有可恢复的实时房间" } satisfies JoinedPayload;
    if (saved.role === "host") {
      this.role = "host";
      this.slot = 0;
      this.token = saved.token;
      this.hostName = cleanName(saved.name);
      this.guestName = saved.guestName ? cleanName(saved.guestName) : "";
      this.guestToken = saved.guestToken ?? "";
      this.snapshot = saved.snapshot ?? null;
      await this.connectRoom(saved.roomId);
      this.publishRoomStatus();
      if (this.snapshot) {
        this.publishSnapshot();
        this.startTicking();
      }
      return { ok: true, roomId: this.roomId, slot: 0, token: this.token } satisfies JoinedPayload;
    }
    return this.requestJoin(saved.roomId, saved.name, saved.token);
  }

  send(command: CommandEnvelope["command"]) {
    const commandId = crypto.randomUUID();
    const envelope: CommandEnvelope = {
      commandId, clientSeq: ++this.seq, expectedStateVersion: this.stateVersion, command,
    };
    if (this.role === "host" && this.snapshot) {
      const result = applyCommand(this.snapshot, 0, command);
      if (!result.ok) this.emit("notice", { message: result.message ?? "操作被拒绝" });
      else {
        this.persistSession();
        this.publishSnapshot();
      }
      return;
    }
    if (this.role === "guest" && this.roomChannel && this.token) {
      this.runInBackground(
        this.broadcast(this.roomChannel, { type: "command", clientId: this.clientId, token: this.token, envelope }),
        "操作发送失败，请检查网络后重试",
      );
    }
  }

  close() {
    this.clearQuickTimers();
    if (this.pendingJoin) window.clearTimeout(this.pendingJoin.timer);
    this.pendingJoin = null;
    this.pendingQuick = null;
    void this.disconnectRoom();
    if (this.quickChannel) {
      const channel = this.quickChannel;
      this.quickChannel = null;
      this.intentionalClosures.add(channel);
      void this.client.removeChannel(channel);
    }
  }
}
