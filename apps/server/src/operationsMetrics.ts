import type {
  OperationsHistoryPoint,
  OperationsMetricsSnapshot,
  OperationsRoomCounts,
  OperationsRoomSummary,
  OperationsTotals,
} from "@adou/shared";

const HISTORY_WINDOW_MS = 60 * 60_000;
const RATE_WINDOW_MS = 60_000;
export const OPERATIONS_SAMPLE_INTERVAL_MS = 5_000;

type CounterKey = keyof OperationsTotals;

interface CounterSample {
  at: number;
  totals: OperationsTotals;
}

export interface OperationsRuntimeState {
  now?: number;
  onlineUsers: number;
  socketConnections: number;
  rooms: OperationsRoomSummary[];
  authenticationRequired: boolean;
  persistenceEnabled: boolean;
  protocolVersion: string;
  rulesetVersion: string;
}

function emptyTotals(): OperationsTotals {
  return {
    connectionsAccepted: 0,
    authenticationRejected: 0,
    disconnects: 0,
    roomsCreated: 0,
    roomsRemoved: 0,
    matchesStarted: 0,
    matchesFinished: 0,
    commandsReceived: 0,
    commandsAccepted: 0,
    commandsRejected: 0,
    resyncRequests: 0,
    checkpointDeliveries: 0,
    estimatedOutboundBytes: 0,
    persistenceWrites: 0,
    persistenceFailures: 0,
    serverErrors: 0,
  };
}

function roomCounts(rooms: OperationsRoomSummary[]): OperationsRoomCounts {
  const result: OperationsRoomCounts = { total: rooms.length, waiting: 0, ready: 0, battle: 0, finished: 0 };
  for (const room of rooms) result[room.state] += 1;
  return result;
}

function cloneTotals(totals: OperationsTotals): OperationsTotals {
  return { ...totals };
}

export class OperationsMetrics {
  readonly startedAt: number;
  private readonly totals = emptyTotals();
  private counterSamples: CounterSample[] = [];
  private history: OperationsHistoryPoint[] = [];
  private lastHistoryAt = 0;
  private smoothedEventLoopDelayMs = 0;
  private adminStreamClients = 0;

  constructor(startedAt = Date.now()) {
    this.startedAt = startedAt;
  }

  increment(counter: CounterKey, amount = 1) {
    this.totals[counter] += amount;
  }

  recordCommand(accepted: boolean) {
    this.increment("commandsReceived");
    this.increment(accepted ? "commandsAccepted" : "commandsRejected");
  }

  recordOutbound(eventName: string, payload: unknown, recipients: number) {
    if (recipients <= 0) return;
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify({ event: eventName, payload }), "utf8") * recipients;
    } catch {
      this.increment("serverErrors");
      return;
    }
    this.increment("estimatedOutboundBytes", bytes);
    if (eventName === "match:checkpoint") this.increment("checkpointDeliveries", recipients);
  }

  observeEventLoopDelay(delayMs: number) {
    const bounded = Math.max(0, Math.min(delayMs, 60_000));
    this.smoothedEventLoopDelayMs = this.smoothedEventLoopDelayMs === 0
      ? bounded
      : (this.smoothedEventLoopDelayMs * 0.85) + (bounded * 0.15);
  }

  streamOpened() {
    this.adminStreamClients += 1;
  }

  streamClosed() {
    this.adminStreamClients = Math.max(0, this.adminStreamClients - 1);
  }

  snapshot(state: OperationsRuntimeState): OperationsMetricsSnapshot {
    const now = state.now ?? Date.now();
    const counts = roomCounts(state.rooms);
    const counterSample: CounterSample = { at: now, totals: cloneTotals(this.totals) };
    this.counterSamples.push(counterSample);
    this.counterSamples = this.counterSamples.filter((sample) => sample.at >= now - RATE_WINDOW_MS);
    const baseline = this.counterSamples[0] ?? counterSample;
    const coveredMs = Math.max(1_000, now - baseline.at);
    const perMinute = (current: number, previous: number) => ((current - previous) * 60_000) / coveredMs;
    const commands = Math.max(0, this.totals.commandsReceived - baseline.totals.commandsReceived);
    const rejected = Math.max(0, this.totals.commandsRejected - baseline.totals.commandsRejected);
    const traffic = {
      commandsPerMinute: perMinute(this.totals.commandsReceived, baseline.totals.commandsReceived),
      rejectedCommandsPerMinute: perMinute(this.totals.commandsRejected, baseline.totals.commandsRejected),
      commandRejectRate: commands === 0 ? 0 : rejected / commands,
      resyncsPerMinute: perMinute(this.totals.resyncRequests, baseline.totals.resyncRequests),
      checkpointsPerMinute: perMinute(this.totals.checkpointDeliveries, baseline.totals.checkpointDeliveries),
      estimatedOutboundBytesPerMinute: perMinute(
        this.totals.estimatedOutboundBytes,
        baseline.totals.estimatedOutboundBytes,
      ),
    };

    if (now - this.lastHistoryAt >= OPERATIONS_SAMPLE_INTERVAL_MS) {
      this.lastHistoryAt = now;
      this.history.push({
        at: new Date(now).toISOString(),
        onlineUsers: state.onlineUsers,
        socketConnections: state.socketConnections,
        rooms: counts.total,
        battles: counts.battle,
        commandsPerMinute: traffic.commandsPerMinute,
        estimatedOutboundBytesPerMinute: traffic.estimatedOutboundBytesPerMinute,
      });
      this.history = this.history.filter((point) => Date.parse(point.at) >= now - HISTORY_WINDOW_MS);
    }

    const memory = process.memoryUsage();
    const seatedOnlinePlayers = state.rooms.reduce((sum, room) => sum + room.connectedPlayers, 0);
    const disconnectedSeats = state.rooms.reduce((sum, room) => sum + room.playerCount - room.connectedPlayers, 0);
    const degraded = this.smoothedEventLoopDelayMs >= 250
      || (this.totals.persistenceFailures > 0 && this.totals.persistenceFailures >= this.totals.persistenceWrites);

    return {
      generatedAt: new Date(now).toISOString(),
      sampleIntervalMs: OPERATIONS_SAMPLE_INTERVAL_MS,
      onlineUsers: state.onlineUsers,
      socketConnections: state.socketConnections,
      seatedOnlinePlayers,
      disconnectedSeats,
      rooms: counts,
      traffic,
      totals: cloneTotals(this.totals),
      health: {
        status: degraded ? "degraded" : "healthy",
        uptimeMs: Math.max(0, now - this.startedAt),
        eventLoopDelayMs: this.smoothedEventLoopDelayMs,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        authenticationRequired: state.authenticationRequired,
        persistenceEnabled: state.persistenceEnabled,
        adminStreamClients: this.adminStreamClients,
        protocolVersion: state.protocolVersion,
        rulesetVersion: state.rulesetVersion,
        nodeVersion: process.version,
      },
      history: [...this.history],
      roomDetails: [...state.rooms].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    };
  }
}
