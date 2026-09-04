import { io, type Socket } from "socket.io-client";
import {
  GAME_CONFIG, MATCH_SNAPSHOT_VERSION, RULESET_VERSION, RULES_CONFIG_SCHEMA_VERSION,
  cloneSnapshot,
  type AppliedCommandPayload, type CommandEnvelope, type GameCommand, type MatchSnapshot, type PlayerSlot,
} from "@adou/shared";
import { replayAuthoritativeCommand } from "./replayAuthoritativeCommand";
import { stepMatchBatch } from "./stepMatchBatch";

type JoinedPayload = { ok: boolean; roomId?: string; slot?: PlayerSlot; token?: string; message?: string };
type AckPayload = JoinedPayload & { stateVersion?: number; code?: string };
type SavedSession = { roomId: string; token: string; slot: PlayerSlot; name: string };

/** Socket.IO transport for the always-on server-authoritative protocol. */
export class AuthoritativeRealtimeClient extends EventTarget {
  private socket: Socket | null = null;
  private readonly pendingCommands = new Map<string, number>();
  private seq = 0;
  private closed = false;
  private listenersBound = false;
  private reconnectPending = false;
  private snapshot: MatchSnapshot | null = null;
  private tickTimer = 0;
  private lastTickAt = 0;
  private tickRemainder = 0;
  private resyncInFlight = false;
  slot: PlayerSlot = 0;
  roomId = "";
  token = "";
  stateVersion = 0;

  constructor(
    private readonly storageKey: string,
    private readonly serverUrl: string,
    private readonly accessToken: () => Promise<string>,
    private readonly socketPath = "/socket.io",
  ) { super(); }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private async connect() {
    if (this.socket?.connected) return this.socket;
    if (this.closed) throw new Error("实时连接已经关闭");
    const token = await this.accessToken();
    const socket = this.socket ?? io(this.serverUrl, {
      path: this.socketPath,
      autoConnect: false,
      transports: ["websocket", "polling"],
      auth: {
        accessToken: token,
        protocolVersion: GAME_CONFIG.protocolVersion,
        rulesetVersion: RULESET_VERSION,
        rulesSchemaVersion: RULES_CONFIG_SCHEMA_VERSION,
        snapshotVersion: MATCH_SNAPSHOT_VERSION,
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 4_000,
      timeout: 8_000,
    });
    this.socket = socket;
    socket.auth = {
      accessToken: token,
      protocolVersion: GAME_CONFIG.protocolVersion,
      rulesetVersion: RULESET_VERSION,
      rulesSchemaVersion: RULES_CONFIG_SCHEMA_VERSION,
      snapshotVersion: MATCH_SNAPSHOT_VERSION,
    };
    if (!this.listenersBound) {
      this.listenersBound = true;
      socket.on("connect", () => {
        this.emit("network", { connected: true });
        if (this.reconnectPending) void this.resumeAfterReconnect(socket);
      });
      socket.on("disconnect", () => {
        if (!this.closed && this.roomId && this.token) this.reconnectPending = true;
        this.stopLocalSimulation();
        this.emit("network", { connected: false });
      });
      socket.on("connect_error", (error) => {
        this.emit("network", { connected: false });
        this.emit("notice", { message: `权威服务器连接失败：${error.message}` });
      });
      socket.on("room:status", (payload) => this.emit("room", payload));
      socket.on("match:start", (payload) => this.emit("start", payload));
      socket.on("match:snapshot", (snapshot: MatchSnapshot) => this.acceptCheckpoint(snapshot));
      socket.on("match:checkpoint", (snapshot: MatchSnapshot) => this.acceptCheckpoint(snapshot));
      socket.on("match:command-applied", (payload: AppliedCommandPayload) => this.applyAuthoritativeCommand(payload));
    }
    if (socket.connected) return socket;
    socket.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { cleanup(); reject(new Error("权威服务器连接超时")); }, 8_000);
      const cleanup = () => {
        window.clearTimeout(timer);
        socket.off("connect", connected);
        socket.off("connect_error", failed);
      };
      const connected = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      socket.once("connect", connected);
      socket.once("connect_error", failed);
    });
    return socket;
  }

  private async resumeAfterReconnect(socket: Socket) {
    try {
      const result = await new Promise<AckPayload>((resolve, reject) => {
        socket.timeout(8_000).emit("room:resume", { roomId: this.roomId, token: this.token },
          (error: Error | null, response: AckPayload) => {
            if (error) reject(new Error("恢复房间超时"));
            else resolve(response);
          });
      });
      if (!result.ok) throw new Error(result.message ?? "恢复房间失败");
      this.reconnectPending = false;
      this.emit("notice", { message: "网络已恢复，已重新进入对局" });
    } catch (error) {
      this.emit("notice", { message: error instanceof Error ? error.message : "恢复房间失败" });
    }
  }

  private async request(event: string, payload: Record<string, unknown>) {
    const socket = await this.connect();
    return new Promise<AckPayload>((resolve, reject) => {
      socket.timeout(8_000).emit(event, payload, (error: Error | null, response: AckPayload) => {
        if (error) reject(new Error("权威服务器响应超时"));
        else resolve(response);
      });
    });
  }

  private remember(result: JoinedPayload, name: string) {
    if (!result.ok || !result.roomId || result.slot === undefined || !result.token) return result;
    this.roomId = result.roomId; this.slot = result.slot; this.token = result.token;
    localStorage.setItem(this.storageKey, JSON.stringify({
      roomId: result.roomId, token: result.token, slot: result.slot, name,
    } satisfies SavedSession));
    return result;
  }

  async create(name: string, _introRound = 10) {
    return this.remember(await this.request("room:create", { name }), name);
  }

  async join(roomId: string, name: string, _introRound = 10) {
    return this.remember(await this.request("room:join", { roomId: roomId.trim().toUpperCase(), name }), name);
  }

  async quick(name: string, _introRound = 10) {
    return this.remember(await this.request("room:quick", { name }), name);
  }

  async resume(roomId: string, token: string) {
    const saved = this.readSavedSession();
    const name = saved?.name ?? "常山侠客";
    return this.remember(await this.request("room:resume", { roomId, token }), name);
  }

  private publishSnapshot() {
    if (!this.snapshot) return;
    this.stateVersion = this.snapshot.stateVersion;
    this.emit("snapshot", cloneSnapshot(this.snapshot));
  }

  private acceptCheckpoint(snapshot: MatchSnapshot) {
    this.snapshot = cloneSnapshot(snapshot);
    this.seq = Math.max(this.seq, this.snapshot.lastClientSeq[this.slot]);
    this.lastTickAt = performance.now();
    this.tickRemainder = 0;
    this.publishSnapshot();
    this.startLocalSimulation();
  }

  private startLocalSimulation() {
    if (!this.snapshot || this.tickTimer || !this.socket?.connected) return;
    const tickMs = 1000 / GAME_CONFIG.tickHz;
    this.tickTimer = window.setInterval(() => {
      if (!this.snapshot || this.snapshot.phase === "finished" || !this.socket?.connected) {
        this.stopLocalSimulation();
        return;
      }
      const now = performance.now();
      const elapsed = Math.min(500, now - this.lastTickAt);
      this.lastTickAt = now;
      this.tickRemainder += elapsed;
      const steps = Math.floor(this.tickRemainder / tickMs);
      if (steps < 1) return;
      this.tickRemainder -= steps * tickMs;
      stepMatchBatch(this.snapshot, steps, tickMs);
      this.publishSnapshot();
    }, tickMs);
  }

  private stopLocalSimulation() {
    window.clearInterval(this.tickTimer);
    this.tickTimer = 0;
    this.tickRemainder = 0;
  }

  private applyAuthoritativeCommand(payload: AppliedCommandPayload) {
    if (!this.snapshot) {
      this.requestResync();
      return;
    }
    if (payload.clientSeq <= this.snapshot.lastClientSeq[payload.slot]) return;
    const replay = replayAuthoritativeCommand(this.snapshot, payload);
    if (!replay) {
      this.requestResync();
      return;
    }
    this.snapshot = replay;
    this.publishSnapshot();
  }

  private requestResync() {
    if (this.resyncInFlight || !this.socket?.connected) return;
    this.resyncInFlight = true;
    this.socket.timeout(4_000).emit("match:resync", {}, (error: Error | null, response: AckPayload) => {
      this.resyncInFlight = false;
      if (error || !response.ok) this.emit("notice", { message: "对局校验未通过，正在等待服务器重新同步" });
    });
  }

  async ready() {
    return this.request("room:ready", {});
  }

  send(command: GameCommand) {
    void (async () => {
      try {
        const socket = await this.connect();
        const commandId = crypto.randomUUID();
        const envelope: CommandEnvelope = {
          commandId, clientSeq: ++this.seq, expectedStateVersion: this.stateVersion, command,
        };
        const timer = window.setTimeout(() => {
          if (!this.pendingCommands.delete(commandId)) return;
          this.emit("notice", { message: "权威服务器未确认操作，正在保留重连凭证" });
        }, 6_000);
        this.pendingCommands.set(commandId, timer);
        socket.timeout(5_000).emit("match:command", envelope, (error: Error | null, response: AckPayload) => {
          window.clearTimeout(this.pendingCommands.get(commandId));
          this.pendingCommands.delete(commandId);
          if (error) this.emit("notice", { message: "操作发送超时，请检查网络" });
          else if (!response.ok) this.emit("notice", { message: response.message ?? "操作被权威服务器拒绝" });
        });
      } catch (error) {
        this.emit("notice", { message: error instanceof Error ? error.message : "操作发送失败" });
      }
    })();
  }

  private readSavedSession(): SavedSession | null {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.storageKey) ?? "null") as SavedSession | null;
      return parsed && typeof parsed.roomId === "string" && typeof parsed.token === "string" ? parsed : null;
    } catch { return null; }
  }

  close() {
    this.closed = true;
    this.reconnectPending = false;
    this.stopLocalSimulation();
    for (const timer of this.pendingCommands.values()) window.clearTimeout(timer);
    this.pendingCommands.clear();
    this.socket?.disconnect();
    this.socket = null;
  }
}
