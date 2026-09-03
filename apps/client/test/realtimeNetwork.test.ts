import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({ createClient }));

import { RealtimeClient } from "../src/net/RealtimeClient";

type SubscribeStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

class FakeChannel {
  private messageListener: ((message: { payload: unknown }) => void) | null = null;
  private statusListener: ((status: SubscribeStatus) => void) | null = null;

  on(_type: string, _filter: unknown, listener: (message: { payload: unknown }) => void) {
    this.messageListener = listener;
    return this;
  }

  subscribe(listener: (status: SubscribeStatus) => void) {
    this.statusListener = listener;
    queueMicrotask(() => listener("SUBSCRIBED"));
    return this;
  }

  async send(message: { payload: Record<string, unknown> }) {
    if (message.payload.type === "join") {
      const request = message.payload;
      queueMicrotask(() => this.messageListener?.({
        payload: {
          type: "join-ack",
          requestId: request.requestId,
          targetId: request.clientId,
          result: { ok: true, roomId: "ABC123", slot: 1, token: "resume-token" },
        },
      }));
    }
    return "ok";
  }

  emitStatus(status: SubscribeStatus) {
    this.statusListener?.(status);
  }
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function browserWindow() {
  const target = new EventTarget() as EventTarget & Pick<Window, "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval">;
  target.setTimeout = globalThis.setTimeout as unknown as Window["setTimeout"];
  target.clearTimeout = globalThis.clearTimeout as unknown as Window["clearTimeout"];
  target.setInterval = globalThis.setInterval as unknown as Window["setInterval"];
  target.clearInterval = globalThis.clearInterval as unknown as Window["clearInterval"];
  return target;
}

describe("Supabase realtime browser network lifecycle", () => {
  let online: { onLine: boolean };
  let windowTarget: ReturnType<typeof browserWindow>;
  let channel: FakeChannel;
  let realtimeConnected: boolean;
  let realtimeConnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    online = { onLine: true };
    windowTarget = browserWindow();
    channel = new FakeChannel();
    realtimeConnected = true;
    realtimeConnect = vi.fn(() => { realtimeConnected = true; });
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("navigator", online);
    vi.stubGlobal("localStorage", memoryStorage());
    createClient.mockReset();
    createClient.mockReturnValue({
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
      realtime: {
        isConnected: vi.fn(() => realtimeConnected),
        connect: realtimeConnect,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports browser offline immediately even while the WebSocket still appears connected", async () => {
    const client = new RealtimeClient("session", { url: "https://example.supabase.co", publishableKey: "test" });
    const states: boolean[] = [];
    client.addEventListener("network", (event) => states.push((event as CustomEvent<{ connected: boolean }>).detail.connected));
    expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "test", {
      auth: {
        storageKey: "session:realtime-auth",
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    await client.join("ABC123", "guest");

    online.onLine = false;
    windowTarget.dispatchEvent(new Event("offline"));

    expect(realtimeConnected).toBe(true);
    expect(states).toEqual([true, false]);

    online.onLine = true;
    windowTarget.dispatchEvent(new Event("online"));
    expect(states).toEqual([true, false, true]);
    expect(realtimeConnect).not.toHaveBeenCalled();
    client.close();
  });

  it("reconnects a closed transport and waits for channel rejoin before reporting connected", async () => {
    const client = new RealtimeClient("session", { url: "https://example.supabase.co", publishableKey: "test" });
    const states: boolean[] = [];
    client.addEventListener("network", (event) => states.push((event as CustomEvent<{ connected: boolean }>).detail.connected));
    await client.join("ABC123", "guest");

    realtimeConnected = false;
    channel.emitStatus("CHANNEL_ERROR");
    online.onLine = false;
    windowTarget.dispatchEvent(new Event("offline"));
    online.onLine = true;
    windowTarget.dispatchEvent(new Event("online"));

    expect(realtimeConnect).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBe(false);

    channel.emitStatus("SUBSCRIBED");
    expect(states).toEqual([true, false, true]);
    client.close();
  });
});
