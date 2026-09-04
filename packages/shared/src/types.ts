import type { ActivePropId, BattleBuffKind, BattlePropId, PassivePropId } from "./config";

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
  /** 武将累计战斗经验；普通兵和旧快照可缺省。 */
  experience?: number;
  /** 关羽连续攻击同一目标的原包被动状态。 */
  repeatedTargetId?: string;
  repeatedTargetAttackBonus?: number;
  /** 原包技能期间 V_=false；权威 Tick 到期前不允许穿插普通攻击。 */
  generalSkillLockMs?: number;
  /** 主动道具永久增益；缺省值均为 1，兼容旧存档。 */
  rangeMultiplier?: number;
  attackSpeedMultiplier?: number;
  /** 砚台造成的临时攻速倍率及剩余时间。 */
  temporaryAttackSpeedMultiplier?: number;
  temporaryAttackSpeedMs?: number;
  /** Boss 控制状态；均由权威模拟推进，升级会清除原包规定可驱散的状态。 */
  bossChaosMs?: number;
  bossSuppressionMs?: number;
  bossSuppressionOriginalLevel?: number;
  bossKnockedDown?: boolean;
  bossLockedMs?: number;
  /** 已通过升级驱散的甄宓降雨来源。 */
  rainDispelledBossIds?: string[];
  incomeMs?: number;
}

export interface ReserveItem {
  id: string;
  kind: string;
  level: number;
  /** 营地内武将保留的累计战斗经验。 */
  experience?: number;
  slot: number;
  /** 营地内两字武将占用的相邻第二格。 */
  secondarySlot?: number;
  /** 两个营地格中显示的姓名字。 */
  parts?: [string, string];
  incomeMs?: number;
}

export interface EnemyState {
  id: string;
  hp: number;
  maxHp: number;
  progress: number;
  boss: boolean;
  /** 原包每张地图三名 Boss 按出场次序循环；旧快照可缺省。 */
  bossType?: number;
  stunnedMs: number;
  /** 原包逐节点移动状态，坐标单位为格，位置对应 80px 格子的左上角。 */
  pathX?: number;
  pathY?: number;
  /** 当前正在前往的完整路径节点下标。 */
  pathIndex?: number;
  moveSpeedMultiplier?: number;
  moveSpeedBuffMs?: number;
  inspireBonusHp?: number;
  scaleMultiplier?: number;
  /** 产品新增局内 BUFF 状态；各计时器由权威模拟推进。 */
  battleInvulnerableMs?: number;
  battleHasteMs?: number;
  battleGiantApplied?: boolean;
  battleRallyMs?: number;
  battleRallyBonusHp?: number;
  /** 张飞普攻命中的 -10% 移速，独立于产品新增 BUFF。 */
  generalSlowMs?: number;
  generalSlowMultiplier?: number;
  bossCooldownMs?: number;
  bossSkillElapsedMs?: number;
  bossSkillTargetIds?: string[];
  bossSkillHitIds?: string[];
  bossSkillUsed?: boolean;
  resurrectionRemaining?: number;
  summonedKind?: "zombie" | "cavalry" | "puppet";
  summonedUnitKind?: string;
  summonedUnitLevel?: number;
}

export interface BattleBuffItem {
  /** 本局唯一实例 ID，成功使用后消耗。 */
  id: string;
  kind: BattleBuffKind;
}

export type BattleFieldEffectState =
  | { id: string; kind: "smoke"; cell: number; remainingMs: number }
  | { id: string; kind: "decoy"; cell: number; remainingHits: number };

export interface ArrowRainImpactState {
  id: string;
  unitId: string;
  x: number;
  y: number;
  damage: number;
  remainingMs: number;
}

export type GeneralSkillName = "七进七出" | "大喝" | "晕眩" | "跳斩" | "火箭烈" | "圣剑" | "箭雨";

/** 锁定目标、等待命中的原包武将技能投射物或连续斩击。 */
export interface PendingGeneralImpactState {
  id: string;
  unitId: string;
  unitKind: string;
  sourceCell: number;
  secondaryCell?: number;
  skillName: GeneralSkillName;
  kind: "jump-slash" | "holy-sword" | "huangzu-arrow";
  targetId: string;
  damage: number;
  remainingMs: number;
  splashRadiusCells?: number;
  splashDamageMultiplier?: number;
  stunMs?: number;
}

/** 赵云幻影沿敌方完整路线往返的确定性运行时状态。 */
export interface ZhaoPhantomState {
  id: string;
  unitId: string;
  unitKind: "赵云";
  x: number;
  y: number;
  pathIndex: number;
  direction: -1 | 1;
  roundTrips: number;
  pulseMs: number;
  launchMs: number;
  damage: number;
  hitEnemyIds: string[];
}

export interface BulldozerState {
  x: number;
  y: number;
  routeIndices: number[];
  cursor: number;
  phase: "moving" | "fading";
  fadeMs: number;
}

export interface PropLoadout {
  active: ActivePropId[];
  passive: Array<{ id: PassivePropId; level: number }>;
}

export interface PlacedPropState {
  id: string;
  propId: 8 | 9;
  cell: number;
}

export interface PlayerPropState {
  configured: boolean;
  /** 原包每日前 3 局在征兵池增加两份铲子权重。 */
  earlyAccountShovelBonus?: boolean;
  loadout: PropLoadout;
  cooldowns: Partial<Record<ActivePropId, number>>;
  /** 有次数限制的主动道具剩余次数；1.0.9 包子的初始次数为 10。 */
  charges?: Partial<Record<ActivePropId, number>>;
  placed: PlacedPropState[];
  farmerSpawnMs: number;
  superShovelMs: number;
  meteorMs: number;
  /** 原包局内“看广告获得两把铲子”；网页端点击直接领取，每局一次。 */
  shovelSupplyClaimed?: boolean;
  /** 原包敌军距终点 5 个路径节点时出现的推土车广告补给；网页端直接领取。 */
  bulldozer?: BulldozerState;
  /** 推土车补给每局只可领取一次；载具离场后仍保持为 true。 */
  bulldozerSupplyClaimed?: boolean;
}

export interface BattleEventBase {
  /** 对局内单调生成、永不复用的事件 ID。 */
  id: string;
  /** 产生事件的模拟 Tick；玩家命令不会额外推进 Tick。 */
  tick: number;
  /** 产生事件的状态转换版本。 */
  stateVersion: number;
}

export type BattleEventPayload =
  | {
    type: "recruited";
    slot: PlayerSlot;
    reserveIds: string[];
    spentBuns: number;
    recycledBuns: number;
  }
  | {
    type: "reserve-granted";
    slot: PlayerSlot;
    reserveIds: string[];
    reason: "shovel-supply" | "farmer" | "super-shovel";
  }
  | {
    type: "unit-deployed";
    slot: PlayerSlot;
    unitId: string;
    unitKind: string;
    cells: number[];
  }
  | {
    type: "unit-moved";
    slot: PlayerSlot;
    unitId: string;
    fromCells: number[];
    toCells: number[];
  }
  | {
    type: "unit-returned";
    slot: PlayerSlot;
    unitId: string;
    unitKind: string;
    slots: number[];
  }
  | {
    type: "units-swapped";
    slot: PlayerSlot;
    placements: Array<{ id: string; cells?: number[]; slots?: number[] }>;
  }
  | {
    type: "units-merged";
    slot: PlayerSlot;
    sourceId: string;
    targetId: string;
    resultKind: string;
    resultLevel: number;
    location: "board" | "reserve";
    cells?: number[];
    slots?: number[];
  }
  | {
    type: "general-split";
    slot: PlayerSlot;
    generalId: string;
    parts: Array<{ id: string; kind: string; cell: number }>;
  }
  | {
    type: "unit-upgraded";
    slot: PlayerSlot;
    unitId: string;
    unitKind: string;
    fromLevel: number;
    toLevel: number;
    experience: number;
    source: "combat-experience";
  }
  | {
    type: "cell-unlocked";
    slot: PlayerSlot;
    cell: number;
    sourceReserveId: string;
  }
  | {
    type: "reserve-moved";
    slot: PlayerSlot;
    reserveId: string;
    slots: number[];
  }
  | {
    type: "prop-used";
    slot: PlayerSlot;
    propId: ActivePropId;
    targetUnitId?: string;
    targetEnemyId?: string;
    targetCell?: number;
    reserveId?: string;
  }
  | {
    type: "prop-triggered";
    slot: PlayerSlot;
    propId: BattlePropId;
    targetIds: string[];
    rewardBuns?: number;
  }
  | {
    type: "battle-buff-dropped";
    slot: PlayerSlot;
    buffInstanceId: string;
    buffKind: BattleBuffKind;
    sourceEnemyId: string;
  }
  | {
    type: "battle-buff-used";
    slot: PlayerSlot;
    buffInstanceId: string;
    buffKind: BattleBuffKind;
    targetSlot: PlayerSlot;
    targetEnemyId?: string;
    targetCell?: number;
    affectedEnemyIds: string[];
  }
  | {
    type: "battle-field-effect-hit";
    slot: PlayerSlot;
    effectId: string;
    effectKind: "decoy";
    unitId: string;
    unitKind: string;
    sourceCell: number;
    secondaryCell?: number;
    targetCell: number;
    remainingHits: number;
  }
  | {
    type: "boss-skill";
    slot: PlayerSlot;
    bossId: string;
    bossType: number;
    skillName: string;
    phase: "cast" | "resolved" | "intercepted";
    targetIds: string[];
  }
  | {
    type: "arrow-rain-impact";
    slot: PlayerSlot;
    unitId: string;
    x: number;
    y: number;
    damage: number;
    targetIds: string[];
  }
  | {
    type: "general-skill";
    slot: PlayerSlot;
    unitId: string;
    unitKind: string;
    skillName: GeneralSkillName;
    sourceCell: number;
    secondaryCell?: number;
    targetId?: string;
  }
  | {
    type: "bulldozer";
    slot: PlayerSlot;
    phase: "launched" | "push" | "expired";
    targetIds: string[];
  }
  | {
    type: "attack";
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
    /** 技能连续命中的名称；启动横幅由 general-skill 事件单独触发。 */
    skillName?: GeneralSkillName;
    /** 幻影等移动施法源可覆盖棋盘格中心，坐标单位为格。 */
    sourceX?: number;
    sourceY?: number;
  }
  | {
    type: "enemy-defeated";
    slot: PlayerSlot;
    enemyId: string;
    boss: boolean;
    rewardBuns: number;
  }
  | {
    type: "player-damaged";
    slot: PlayerSlot;
    escapedCount: number;
    remainingHp: number;
    awardedBuns: number;
  }
  | {
    type: "match-finished";
    winner: PlayerSlot | "draw";
  };

/** 可 JSON 序列化、只描述已结算事实的一次性战斗事件。 */
export type BattleEvent = BattleEventPayload extends infer Payload
  ? Payload extends object ? BattleEventBase & Payload : never
  : never;

/** @deprecated 攻击事件兼容别名；新消费者应读取 MatchSnapshot.events。 */
export type CombatEffectEvent = Extract<BattleEvent, { type: "attack" }>;

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
  /** 原包从 0 开始的账号对局轮次；前 10 局且前 10 波使用新手生命系数。 */
  introRound?: number;
  /** 原包整局持续消耗的征兵牌库；基础兵/铲子保留，姓名字抽中后移除。 */
  recruitPool?: string[];
  /** 招贤榜已在本局牌库上执行，兼容旧快照可缺省。 */
  recruitNameBonusApplied?: boolean;
  units: UnitState[];
  reserve: ReserveItem[];
  /** 初始为地图里的 1_0；铲子可加入任意己方 2_0，不要求相邻。 */
  unlockedCells: number[];
  enemies: EnemyState[];
  /** 仅在当前对局快照中存在，不进入账号道具数据库。 */
  battleBuffs?: BattleBuffItem[];
  /** 对手投放到本方棋盘的烟幕和诱敌木桩，仅在当前对局存在。 */
  battleFieldEffects?: BattleFieldEffectState[];
  pendingArrowImpacts?: ArrowRainImpactState[];
  pendingGeneralImpacts?: PendingGeneralImpactState[];
  zhaoPhantoms?: ZhaoPhantomState[];
  /** 仍在生效的甄宓降雨 Boss；每个来源对尚未升级驱散的单位施加 -20% 攻速。 */
  rainBossIds?: string[];
  visionDarkMs?: number;
  /** 道具状态为可选以继续读取早期云存档；演算时会补齐。 */
  props?: PlayerPropState;
  lastEvent: string;
}

export const MATCH_SNAPSHOT_VERSION = 1 as const;

export interface MatchSnapshot {
  /** 可持久化快照的规范结构版本。 */
  version: typeof MATCH_SNAPSHOT_VERSION;
  /** @deprecated 1.0 快照兼容别名；与 version 保持一致。 */
  snapshotVersion: typeof MATCH_SNAPSHOT_VERSION;
  /** 对局使用的原版规则版本；服务端握手和恢复时必须一致。 */
  rulesetVersion: typeof import("./config").RULESET_VERSION;
  /** 机器规则配置结构版本；与玩法版本分开演进。 */
  rulesConfigSchemaVersion: typeof import("./config").RULES_CONFIG_SCHEMA_VERSION;
  roomId: string;
  tick: number;
  stateVersion: number;
  /** 从对局创建开始累计的确定性逻辑毫秒数。 */
  simulationTimeMs: number;
  seed: number;
  mapIndex: number;
  phase: MatchPhase;
  difficultyCurve: number;
  bossWaves: number[];
  players: [PlayerBattleState, PlayerBattleState];
  /** 最近一次成功命令或模拟步产生的一次性事件。 */
  events: BattleEvent[];
  /** 下一个事件 ID 的持久化序号。 */
  eventSequence: number;
  /** @deprecated 当前转换中的攻击事件兼容视图。 */
  combatEvents: CombatEffectEvent[];
  /** 已成功接受的命令；用于存档/重连后的幂等重试。 */
  acceptedCommands: Record<string, AcceptedCommandRecord>;
  /** 每个席位最后成功接受的客户端序号。 */
  lastClientSeq: [number, number];
  winner: PlayerSlot | "draw" | null;
  /** @deprecated 与 simulationTimeMs 同步的 0.x 兼容字段，不表示墙钟。 */
  serverTime: number;
}

type MigratableMatchSnapshotField =
  | "version"
  | "snapshotVersion"
  | "rulesetVersion"
  | "rulesConfigSchemaVersion"
  | "simulationTimeMs"
  | "events"
  | "eventSequence"
  | "combatEvents"
  | "acceptedCommands"
  | "lastClientSeq";

/** 可由内核规范化的当前快照或已发布的 0.x / 1.0 快照形状。 */
export type MatchSnapshotInput =
  & Omit<MatchSnapshot, MigratableMatchSnapshotField>
  & Partial<Pick<MatchSnapshot, MigratableMatchSnapshotField>>;

export type GameCommand =
  | { type: "RECRUIT" }
  | { type: "SET_PROP_LOADOUT"; loadout: PropLoadout; earlyAccountShovelBonus?: boolean }
  | { type: "USE_PROP"; propId: ActivePropId; targetUnitId?: string; targetEnemyId?: string; targetCell?: number; reserveId?: string }
  | { type: "USE_BATTLE_BUFF"; buffInstanceId: string; targetEnemyId?: string; targetCell?: number }
  | { type: "CLAIM_SHOVEL_SUPPLY" }
  | { type: "CLAIM_BULLDOZER_SUPPLY" }
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

/** 服务端完成校验和排序后，向房间内双方广播的轻量命令。 */
export interface AppliedCommandPayload {
  slot: PlayerSlot;
  commandId: string;
  clientSeq: number;
  command: GameCommand;
  tick: number;
  stateVersionBefore: number;
  eventSequenceBefore: number;
}

export type CommandErrorCode =
  | "ERR_INVALID_ENVELOPE"
  | "ERR_COMMAND_ID_CONFLICT"
  | "ERR_STATE_VERSION"
  | "ERR_CLIENT_SEQUENCE"
  | "ERR_MATCH_ENDED"
  | "ERR_NOT_ENOUGH_BUN"
  | "ERR_INVALID_COMMAND";

export interface CommandSuccess {
  commandId: string;
  ok: true;
  duplicate: boolean;
  /** 成功结果不携带错误；保留可选键以兼容 0.x 消费者的直接读取。 */
  code?: never;
  message?: never;
  stateVersion: number;
}

export interface CommandFailure {
  commandId: string;
  ok: false;
  duplicate: false;
  code: CommandErrorCode;
  message: string;
  stateVersion: number;
}

export type CommandResult = CommandSuccess | CommandFailure;

export interface AcceptedCommandRecord {
  slot: PlayerSlot;
  clientSeq: number;
  expectedStateVersion: number;
  command: GameCommand;
  result: CommandSuccess;
}
