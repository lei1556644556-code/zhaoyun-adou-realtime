import { io, type Socket } from "socket.io-client";
import type { CommandEnvelope, MatchSnapshot, PlayerSlot } from "@adou/shared";

type JoinedPayload = { ok: boolean; roomId?: string; slot?: PlayerSlot; token?: string; message?: string };

export class RealtimeClient extends EventTarget {
  private socket: Socket;
  private seq = 0;
  slot: PlayerSlot = 0;
  roomId = "";
  token = "";
  stateVersion = 0;
  private connectedOnce = false;
  private resuming = false;

  constructor(serverUrl: string) {
    super();
    this.socket = io(serverUrl, { transports: ["websocket", "polling"], autoConnect: true });
    this.socket.on("connect", () => {
      this.emit("network", { connected: true });
      if (this.connectedOnce && this.roomId && this.token && !this.resuming) {
        this.resuming = true;
        void this.resume(this.roomId, this.token)
          .then((result) => {
            if (!result.ok) this.emit("notice", { message: result.message ?? "自动重连房间失败" });
          })
          .finally(() => { this.resuming = false; });
      }
      this.connectedOnce = true;
    });
    this.socket.on("disconnect", () => this.emit("network", { connected: false }));
    this.socket.on("connect_error", (error) => this.emit("notice", { message: `服务器连接失败：${error.message}` }));
    this.socket.on("room:status", (status) => this.emit("room", status));
    this.socket.on("match:start", (payload) => this.emit("start", payload));
    this.socket.on("match:snapshot", (snapshot: MatchSnapshot) => {
      this.stateVersion = snapshot.stateVersion;
      this.emit("snapshot", snapshot);
    });
  }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private request(event: string, payload: Record<string, unknown>) {
    return new Promise<JoinedPayload>((resolve) => this.socket.emit(event, payload, resolve));
  }

  private remember(result: JoinedPayload) {
    if (!result.ok || result.slot === undefined || !result.roomId || !result.token) return result;
    this.slot = result.slot; this.roomId = result.roomId; this.token = result.token;
    localStorage.setItem("adou-session", JSON.stringify({ roomId: this.roomId, token: this.token }));
    return result;
  }

  async create(name: string) { return this.remember(await this.request("room:create", { name })); }
  async join(roomId: string, name: string) { return this.remember(await this.request("room:join", { roomId, name })); }
  async quick(name: string) { return this.remember(await this.request("room:quick", { name })); }
  async resume(roomId: string, token: string) { return this.remember(await this.request("room:resume", { roomId, token })); }

  send(command: CommandEnvelope["command"]) {
    const commandId = crypto.randomUUID();
    const envelope: CommandEnvelope = {
      commandId, clientSeq: ++this.seq, expectedStateVersion: this.stateVersion, command,
    };
    this.socket.emit("match:command", envelope, (result: { ok: boolean; message?: string; stateVersion?: number }) => {
      if (!result.ok) this.emit("notice", { message: result.message ?? "操作被服务器拒绝" });
      if (result.stateVersion !== undefined) this.stateVersion = result.stateVersion;
    });
  }

  close() { this.socket.close(); }
}
