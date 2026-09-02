export type PlayerSlot = 0 | 1;
export type MatchPhase = "waiting" | "preparing" | "battle" | "finished";

export interface UnitState {
  id: string;
  kind: string;
  level: number;
  /** 以玩家自己位于下半场的 8×10 棋盘坐标存储。 */
  cell: number;
  /** 两字武将占用的第二格；普通单位没有该字段。 */
  secondaryCell?: number;
  /** 两格中显示的原始姓名字，按 cell、secondaryCell 的顺序排列。 */
  parts?: [string, string];
  cooldownMs: number;
  attackCount: number;
}

export interface ReserveItem {
  id: string;
  kind: string;
  level: number;
  slot: number;
  /** 营地内两字武将占用的相邻第二格。 */
  secondarySlot?: number;
  /** 两个营地格中显示的姓名字。 */
  parts?: [string, string];
}

export interface EnemyState {
  id: string;
  hp: number;
  maxHp: number;
  progress: number;
  boss: boolean;
  stunnedMs: number;
}

export interface CombatEffectEvent {
  id: string;
  slot: PlayerSlot;
  unitId: string;
  unitKind: string;
  sourceCell: number;
  secondaryCell?: number;
  targetId: string;
  targetProgress: number;
  targetBoss: boolean;
  damage: number;
  hitCount: number;
  special: boolean;
}

export interface PlayerBattleState {
  slot: PlayerSlot;
  hp: number;
  maxHp: number;
  buns: number;
  recruitCost: number;
  recruitCount: number;
  wave: number;
  phase: MatchPhase;
  prepareMs: number;
  interwaveMs: number;
  spawnMs: number;
  remainingToSpawn: number;
  units: UnitState[];
  reserve: ReserveItem[];
  /** 初始为地图里的 1_0，铲子可加入相邻的 2_0。 */
  unlockedCells: number[];
  enemies: EnemyState[];
  lastEvent: string;
}

export interface MatchSnapshot {
  roomId: string;
  tick: number;
  stateVersion: number;
  seed: number;
  mapIndex: number;
  phase: MatchPhase;
  difficultyCurve: number;
  bossWaves: number[];
  players: [PlayerBattleState, PlayerBattleState];
  /** 当前权威 Tick 内发生的攻击；客户端只据此播放表现，不参与伤害计算。 */
  combatEvents: CombatEffectEvent[];
  winner: PlayerSlot | "draw" | null;
  serverTime: number;
}

export type GameCommand =
  | { type: "RECRUIT" }
  | { type: "DROP_RESERVE"; reserveId: string; targetCell: number }
  | { type: "DROP_RESERVE_TO_SLOT"; reserveId: string; targetSlot: number }
  | { type: "DROP_UNIT"; unitId: string; targetCell: number }
  | { type: "DROP_UNIT_TO_RESERVE"; unitId: string; targetSlot: number }
  | { type: "SPLIT_GENERAL"; unitId: string; partIndex: 0 | 1; targetCell: number }
  | { type: "MOVE"; unitId: string; targetCell: number }
  | { type: "MERGE"; sourceId: string; targetId: string };

export interface CommandEnvelope {
  commandId: string;
  clientSeq: number;
  expectedStateVersion: number;
  command: GameCommand;
}

export interface CommandResult {
  commandId: string;
  ok: boolean;
  code?: string;
  message?: string;
  stateVersion: number;
}
