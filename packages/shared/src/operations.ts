export type OperationsRoomState = "waiting" | "ready" | "battle" | "finished";

export interface OperationsPlayerSummary {
  slot: 0 | 1;
  name: string;
  connected: boolean;
  ready: boolean;
}

export interface OperationsRoomSummary {
  roomId: string;
  state: OperationsRoomState;
  players: OperationsPlayerSummary[];
  playerCount: number;
  connectedPlayers: number;
  readyPlayers: number;
  wave: number | null;
  ageMs: number;
  simulationTimeMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperationsRoomCounts {
  total: number;
  waiting: number;
  ready: number;
  battle: number;
  finished: number;
}

export interface OperationsTrafficRates {
  commandsPerMinute: number;
  rejectedCommandsPerMinute: number;
  commandRejectRate: number;
  resyncsPerMinute: number;
  checkpointsPerMinute: number;
  estimatedOutboundBytesPerMinute: number;
}

export interface OperationsTotals {
  connectionsAccepted: number;
  authenticationRejected: number;
  disconnects: number;
  roomsCreated: number;
  roomsRemoved: number;
  matchesStarted: number;
  matchesFinished: number;
  commandsReceived: number;
  commandsAccepted: number;
  commandsRejected: number;
  resyncRequests: number;
  checkpointDeliveries: number;
  estimatedOutboundBytes: number;
  persistenceWrites: number;
  persistenceFailures: number;
  serverErrors: number;
}

export interface OperationsHistoryPoint {
  at: string;
  onlineUsers: number;
  socketConnections: number;
  rooms: number;
  battles: number;
  commandsPerMinute: number;
  estimatedOutboundBytesPerMinute: number;
}

export interface OperationsServerHealth {
  status: "healthy" | "degraded";
  uptimeMs: number;
  eventLoopDelayMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  hostTotalBytes?: number;
  hostFreeBytes?: number;
  authenticationRequired: boolean;
  persistenceEnabled: boolean;
  adminStreamClients: number;
  protocolVersion: string;
  rulesetVersion: string;
  nodeVersion: string;
}

export interface OperationsMetricsSnapshot {
  generatedAt: string;
  sampleIntervalMs: number;
  onlineUsers: number;
  socketConnections: number;
  seatedOnlinePlayers: number;
  disconnectedSeats: number;
  rooms: OperationsRoomCounts;
  traffic: OperationsTrafficRates;
  totals: OperationsTotals;
  health: OperationsServerHealth;
  history: OperationsHistoryPoint[];
  roomDetails: OperationsRoomSummary[];
}
