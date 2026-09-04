/** 原作规则版本；与网络协议版本分开演进。 */
export const RULESET_VERSION = "1.0.9" as const;
export const RULES_CONFIG_SCHEMA_VERSION = "1.4.0" as const;

export type RuleVerificationStatus =
  | "package-recorded"
  | "pending-original-verification"
  | "project-adaptation";

export interface RuleProvenanceEntry {
  status: RuleVerificationStatus;
  evidenceRefs: readonly string[];
  note: string;
}

/**
 * 仓库内保留的取证索引。原 XAPK、解包目录和静态分析片段未提交，
 * 因此 package-recorded 表示“现有取证记录声明已从原包核对”，不表示可在本仓库独立重放。
 */
export const RULE_EVIDENCE_SOURCES = {
  originalPackage: {
    version: "Android 1.0.9 (10)",
    packageName: "com.zyyad.mihuan",
    recordedSha256: "a7c89bb6aab69910d510164361c37127130f7126c8200a39fd0bf8a0667336bd",
    artifactPath: null,
    repositoryReproducible: false,
  },
  candidateSpecification: {
    ref: "SPEC-DOCX",
    path: "赵云与阿斗_真人实时对战完整规则案_v0.9候选稿.docx",
    sha256: "5417a0ed518196ce59bc1c3ddf23f06ef5383f2014652fed3eaaf735efa57e84",
  },
  baselineDocument: { ref: "RULES-MD", path: "docs/RULES_1.0.9_BASELINE.md" },
  propsDocument: { ref: "PROPS-MD", path: "docs/PROPS_1.0.9_IMPLEMENTATION.md" },
  restoredMethods: { ref: "ORIGINAL-1.0.9", path: "docs/evidence/ORIGINAL_1.0.9_RULE_METHODS.md" },
  extractor: { ref: "DCC-TOOL", path: "tools/extract-laya-dcc.cjs" },
} as const;

export const RULE_PROVENANCE = {
  openingAndBoard: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#2.1", "SPEC-DOCX#table-6", "SPEC-DOCX#appendix-d-timing", "RULES-MD#1"],
    note: "开局生命、馒头、棋盘尺寸、准备时间、同波出兵间隔与波间时间在候选取证记录中标为包体值。",
  },
  recruitmentPool: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-10", "RULES-MD#2", "ORIGINAL-1.0.9#on.FO"],
    note: "23 个条目的权重求和为 108；基础兵/铲子保留，姓名字抽中后从整局牌库移除。",
  },
  earlyAccountShovelBonus: {
    status: "package-recorded",
    evidenceRefs: ["RULES-MD#2", "ORIGINAL-1.0.9#on.UO"],
    note: "原包 on.UO：每日前 3 局按 floor(牌库铲子数/5) 追加铲子；基础 11 份因此追加 2 份。",
  },
  campAndRecycle: {
    status: "pending-original-verification",
    evidenceRefs: ["RULES-MD#2", "SPEC-DOCX#table-46"],
    note: "五格营地有包体记录；自动回收公式缺少可重放原包片段。",
  },
  mergePairs: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-15", "RULES-MD#3"],
    note: "12 组武将姓名关系与等级上限在候选取证记录中标为包体值。",
  },
  twoCellGeneralAndSplit: {
    status: "pending-original-verification",
    evidenceRefs: ["RULES-MD#3", "docs/contracts/battle-command.md#1"],
    note: "产品已确认战场横向相邻即合将、移走即失效；原包证据仍待补齐。",
  },
  soldierAndGeneralStats: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-11", "SPEC-DOCX#table-12", "ORIGINAL-1.0.9#Et"],
    note: "已核对 Et：普通兵 dp/gp 与武将 Yp/Op 是四条独立成长曲线，并记录武将攻击形态和索敌。",
  },
  generalExperience: {
    status: "pending-original-verification",
    evidenceRefs: ["SPEC-DOCX#3.3", "SPEC-DOCX#table-14", "ORIGINAL-1.0.9#ri.X_/Ta.X_"],
    note: "候选取证稿记录累计经验阈值和直接击杀 +1；0.5/0.2 参与分配分支缺少完整触发调用链，暂不执行。",
  },
  attackCollision: {
    status: "package-recorded",
    evidenceRefs: ["RULES-MD#4", "ORIGINAL-1.0.9#d.Si"],
    note: "已从 1.0.9 恢复代码核对：攻击圆半径减 1px 后，与敌军完整一格碰撞盒做含边界圆矩形相交。",
  },
  wavesAndBossChance: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-21", "SPEC-DOCX#table-22", "RULES-MD#6", "ORIGINAL-1.0.9#S/It.Ty/It.Ry"],
    note: "已核对 20 波、三条难度曲线、新手前十局系数、50/10px 每秒移速、Boss 轮换及 7/10/14 倍血量。",
  },
  mapLayouts: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-16", "SPEC-DOCX#table-17", "SPEC-DOCX#table-18", "SPEC-DOCX#table-19", "RULES-MD#7"],
    note: "四张 8×10 地图格子矩阵已按候选包体表记录进入共享配置。",
  },
  mapPathInterpolation: {
    status: "package-recorded",
    evidenceRefs: ["ORIGINAL-1.0.9#_s.move", "RULES-MD#7", "packages/shared/test/simulation.test.ts#node-handoff"],
    note: "按 _s.move 恢复为逐节点像素移动；距节点小于 1px 的一帧只切换索引，不移动且不夹取。",
  },
  bossSkillRuntime: {
    status: "package-recorded",
    evidenceRefs: ["ORIGINAL-1.0.9#ft/It", "packages/shared/test/simulation.test.ts#boss-skills"],
    note: "12 套 Boss 目标、数值、持续时间、召唤/转化、解除条件与降妖符拦截已进入共享权威模拟。",
  },
  huangZhongArrowRain: {
    status: "package-recorded",
    evidenceRefs: ["ORIGINAL-1.0.9#Na.TF/_R", "packages/shared/test/simulation.test.ts#huangzhong-rain"],
    note: "逐路径节点生成、±24px 落点、Fisher–Yates 洗牌、500–749ms 逐箭延迟、2倍伤害与150px碰撞半径已冻结。",
  },
  bulldozerAndGoldSeeker: {
    status: "package-recorded",
    evidenceRefs: ["ORIGINAL-1.0.9#push-cart", "ORIGINAL-1.0.9#Dn.SY", "packages/shared/test/simulation.test.ts#bulldozer/gold-seeker"],
    note: "推土车 12 节点/50px每秒/40px碰撞/39px偏移/5秒淡出，以及摸金每铲1–10馒头均已恢复。",
  },
  propsCatalog: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#6.1", "SPEC-DOCX#table-24", "PROPS-MD#1", "PROPS-MD#2"],
    note: "25 行原始字段表以及主动 2、被动 6 的槽位与 ID 分组有候选包体记录。",
  },
  propRuntimeDetails: {
    status: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#2", "PROPS-MD#5"],
    note: "包子、御敌千里、农民、招贤榜和行军丹已补最小方法摘录；其余精确半径、概率分支、生成条件仍待核。",
  },
  propAcquisition: {
    status: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#4", "SPEC-DOCX#6.1"],
    note: "广告、商店、转盘与日重置流程有实现记录，但 ja/Ha 业务语义存在文档冲突。",
  },
  directGrantInsteadOfAds: {
    status: "project-adaptation",
    evidenceRefs: ["PROPS-MD#4"],
    note: "原作广告入口在本项目改为直接获得；属于明确产品映射，不冒充原包规则。",
  },
  battleBuffDrops: {
    status: "project-adaptation",
    evidenceRefs: ["docs/contracts/battle-buff.md"],
    note: "普通敌兵 8% 掉落四种等概率局内 BUFF，是产品新增互动机制，不属于原包 1.0.9。",
  },
  authoritativeTickRate: {
    status: "project-adaptation",
    evidenceRefs: ["RULES-MD#8", "SPEC-DOCX#9.5"],
    note: "10Hz 是当前实时实现选择；候选稿将服务器 tick 标为 RT_TBD。",
  },
} as const satisfies Record<string, RuleProvenanceEntry>;

export const GAME_CONFIG = {
  protocolVersion: "0.5.0",
  columns: 8,
  rows: 10,
  designWidth: 640,
  designHeight: 1386,
  mapTop: 200,
  cellSize: 80,
  reserveSize: 5,
  baseHp: 3,
  maxWaves: 20,
  startBuns: 20,
  recruitBase: 10,
  recruitStep: 2,
  normalKillBuns: 1,
  bossKillBuns: 10,
  hpLostBuns: 10,
  prepareMs: 10_000,
  spawnMs: 1_500,
  interwaveMs: 5_000,
  tickHz: 10,
} as const;

/** 1.0.9 安装包征兵池；每次征兵独立抽取五次。 */
export const TOKEN_POOL = [
  ["刀", 21], ["弓", 19], ["枪", 18], ["骑", 17], ["铲子", 11],
  ["赵", 2], ["云", 1], ["张", 2], ["飞", 1], ["马", 2], ["超", 1],
  ["关", 1], ["羽", 1], ["平", 1], ["兴", 1], ["黄", 2], ["忠", 1],
  ["苞", 1], ["翼", 1], ["盖", 1], ["祖", 1], ["刘", 1], ["备", 1],
] as const;

/** 原包 on.UO：每日前 3 局按 floor(基础铲子数/5) 追加。 */
export const EARLY_ACCOUNT_SHOVEL_BONUS = 2;
export const TOKEN_POOL_BASE_WEIGHT = TOKEN_POOL.reduce((sum, [, weight]) => sum + weight, 0);
export const TOKEN_POOL_SHOVEL_WEIGHT = TOKEN_POOL.reduce(
  (sum, [kind, weight]) => sum + (kind === "铲子" ? weight : 0), 0,
);
export const EARLY_ACCOUNT_TOKEN_POOL_WEIGHT = TOKEN_POOL_BASE_WEIGHT + EARLY_ACCOUNT_SHOVEL_BONUS;
export const EARLY_ACCOUNT_SHOVEL_WEIGHT = TOKEN_POOL_SHOVEL_WEIGHT + EARLY_ACCOUNT_SHOVEL_BONUS;

export const RECRUITMENT_RULES = {
  drawsPerRecruit: GAME_CONFIG.reserveSize,
  drawMode: "persistent-pool; soldiers/shovel-with-replacement; general-names-without-replacement",
  basePool: TOKEN_POOL,
  baseWeightTotal: TOKEN_POOL_BASE_WEIGHT,
  earlyAccount: {
    eligibilityDailyMatches: 3,
    bonusFormula: "floor(baseShovelWeight/5)",
    shovelBonusWeight: EARLY_ACCOUNT_SHOVEL_BONUS,
    effectiveWeightTotal: EARLY_ACCOUNT_TOKEN_POOL_WEIGHT,
    effectiveShovelWeight: EARLY_ACCOUNT_SHOVEL_WEIGHT,
  },
  reserve: {
    capacity: GAME_CONFIG.reserveSize,
    replaceOnRecruit: true,
    recycleShovelBuns: 1,
    recycleByLevelFormula: "2^(level-1)",
  },
} as const;

export type SoldierKind = "刀" | "弓" | "枪" | "骑";
export type TokenKind = (typeof TOKEN_POOL)[number][0];
export type MapCode = `${0 | 1 | 2}_${0 | 1}`;

export const SOLDIERS: Record<SoldierKind, {
  attack: number; intervalMs: number; range: number; form: string; target: string; maxLevel: number;
}> = {
  刀: { attack: 3, intervalMs: 800, range: 1.5, form: "单体", target: "最近敌人", maxLevel: 5 },
  弓: { attack: 2, intervalMs: 800, range: 3.5, form: "单体", target: "最接近终点", maxLevel: 5 },
  枪: { attack: 2, intervalMs: 800, range: 2.5, form: "贯穿", target: "最近敌人", maxLevel: 5 },
  骑: { attack: 2, intervalMs: 800, range: 2.0, form: "范围", target: "最近敌人", maxLevel: 5 },
};

export const ATTACK_RANGE_RULES = {
  unit: "cell",
  originalCellPx: GAME_CONFIG.cellSize,
  sourceShape: "circle",
  targetCollisionBox: { widthCells: 1, heightCells: 1 },
  radiusReductionPx: 1,
  boundaryInclusive: true,
  generalOrigin: "center-between-two-occupied-cells",
} as const;

export const HERO_PAIRS: Record<string, string> = {
  "云+赵": "赵云", "赵+云": "赵云", "张+飞": "张飞", "飞+张": "张飞",
  "马+超": "马超", "超+马": "马超", "关+羽": "关羽", "羽+关": "关羽",
  "关+平": "关平", "平+关": "关平", "关+兴": "关兴", "兴+关": "关兴",
  "张+苞": "张苞", "苞+张": "张苞", "张+翼": "张翼", "翼+张": "张翼",
  "黄+忠": "黄忠", "忠+黄": "黄忠", "黄+盖": "黄盖", "盖+黄": "黄盖",
  "黄+祖": "黄祖", "祖+黄": "黄祖", "刘+备": "刘备", "备+刘": "刘备",
};

export const MERGE_RULES = {
  ordinary: {
    requiresSameKind: true,
    requiresSameLevel: true,
    levelIncrease: 1,
    consumesSource: true,
  },
  generals: {
    pairs: HERO_PAIRS,
    orderIndependent: true,
    occupiedCells: 2,
    adjacency: "horizontal",
    trigger: "automatic-after-board-placement-or-move",
    splitAnyPartToEmptyOpenCell: true,
    dissolveWhenPartsSeparate: true,
  },
} as const;

export type HeroRarity = "gold" | "purple";

export type UnitTargetRule = "nearest" | "closest-end";

export const GENERALS: Record<string, {
  weapon: string; attack: number; intervalMs: number; range: number; maxLevel: number; rarity: HeroRarity;
  form: string; target: UnitTargetRule; skill: string;
}> = {
  赵云: { weapon: "枪", attack: 2, intervalMs: 800, range: 2.5, maxLevel: 5, rarity: "gold", form: "快攻贯穿", target: "closest-end", skill: "30次普攻后七进七出，往返突进7次" },
  张飞: { weapon: "枪", attack: 10, intervalMs: 1000, range: 2.5, maxLevel: 5, rarity: "gold", form: "范围", target: "nearest", skill: "15次普攻后范围眩晕2秒" },
  马超: { weapon: "枪", attack: 10, intervalMs: 1000, range: 2.5, maxLevel: 5, rarity: "gold", form: "单体", target: "nearest", skill: "普攻30%眩晕0.5秒；Boss 10%/0.2秒" },
  关羽: { weapon: "刀", attack: 20, intervalMs: 1000, range: 2.5, maxLevel: 5, rarity: "gold", form: "单体", target: "nearest", skill: "20次普攻后连续5次跳斩，50%范围溅射" },
  黄忠: { weapon: "弓", attack: 6, intervalMs: 800, range: 4.5, maxLevel: 5, rarity: "gold", form: "贯穿", target: "nearest", skill: "30次普攻后火箭雨；每支火箭2倍攻击" },
  关平: { weapon: "刀", attack: 3, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", form: "范围", target: "nearest", skill: "15次普攻后范围眩晕1秒" },
  关兴: { weapon: "刀", attack: 7, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", form: "单体", target: "closest-end", skill: "10%概率眩晕普通敌人0.3秒" },
  张苞: { weapon: "枪", attack: 7, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", form: "单体", target: "closest-end", skill: "10%概率眩晕普通敌人0.3秒" },
  张翼: { weapon: "骑/剑", attack: 7, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", form: "单体", target: "closest-end", skill: "20次普攻后下一次跳斩，50%范围溅射" },
  黄盖: { weapon: "骑/剑", attack: 8, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", form: "单体", target: "nearest", skill: "无额外武将技能" },
  刘备: { weapon: "骑/剑", attack: 10, intervalMs: 800, range: 2.5, maxLevel: 5, rarity: "gold", form: "单体", target: "nearest", skill: "20次普攻后圣剑，5倍攻击并击倒2秒" },
  黄祖: { weapon: "弓", attack: 6, intervalMs: 800, range: 3.5, maxLevel: 3, rarity: "purple", form: "单体", target: "closest-end", skill: "30次普攻后箭雨：5轮，每轮10箭" },
};

/** 原包 Et.dp / Et.gp：普通兵攻击与攻速共用这一组递推结果。 */
export const SOLDIER_LEVEL_ATTACK = [1, 1.5, 2.1, 2.73, 3.4125] as const;
export const SOLDIER_LEVEL_SPEED = [1, 1.5, 2.1, 2.73, 3.4125] as const;
/** 原包 Et.Yp / Et.Op：武将使用独立的攻击与攻速成长。 */
export const GENERAL_LEVEL_ATTACK = [1, 1.5, 2.1, 2.73, 3.276] as const;
export const GENERAL_LEVEL_SPEED = [1, 1.3, 1.56, 1.794, 1.9734] as const;
/** 候选取证稿表 14：武将累计经验阈值；当前仅执行已明确归属的直接击杀 +1。 */
export const GENERAL_EXPERIENCE = {
  directKill: 1,
  sharedParticipation: 0.5,
  specialParticipation: 0.2,
  thresholds: {
    gold: [0, 10, 35, 75, 130],
    purple: [0, 8, 23],
  },
  implementedAttribution: "direct-killing-blow-only",
  verification: "pending-original-verification",
} as const;

export type BattleBuffKind = "invulnerable" | "haste" | "giant" | "rally";

export interface BattleBuffConfig {
  kind: BattleBuffKind;
  name: string;
  glyph: string;
  intro: string;
  color: string;
  durationMs: number | null;
}

/** 产品新增的局内互动 BUFF；顺序也是确定性等概率抽取顺序。 */
export const BATTLE_BUFFS = [
  { kind: "invulnerable", name: "金刚护体", glyph: "免", intro: "使目标怪物 5 秒内免疫任何伤害。", color: "#f5c65d", durationMs: 5_000 },
  { kind: "haste", name: "疾行", glyph: "疾", intro: "使目标怪物移动速度翻倍，持续 10 秒。", color: "#56cfe1", durationMs: 10_000 },
  { kind: "giant", name: "巨灵", glyph: "巨", intro: "使目标怪物放大 2 倍，当前生命和生命上限变为原来的 2.5 倍，持续至离场。", color: "#ef8354", durationMs: null },
  { kind: "rally", name: "振奋", glyph: "振", intro: "半径 2 格内全体怪物移动速度和生命均 +20%，持续 6 秒。", color: "#9bde7e", durationMs: 6_000 },
] as const satisfies readonly BattleBuffConfig[];

export const BATTLE_BUFF_DROP = {
  chance: 0.08,
  eligible: "normal-enemy-defeat",
  selection: "uniform",
} as const;
/** @deprecated 旧消费者兼容别名；等同武将成长，普通兵不得再使用。 */
export const LEVEL_ATTACK = GENERAL_LEVEL_ATTACK;
/** @deprecated 旧消费者兼容别名；等同武将成长，普通兵不得再使用。 */
export const LEVEL_SPEED = GENERAL_LEVEL_SPEED;

export type PropRarity = 0 | 1 | 2 | 3;
export type ActivePropId = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 21;
export type PassivePropId = 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 22 | 24;
export type BattlePropId = ActivePropId | PassivePropId;
export type PropTarget = "own-unit" | "enemy-area" | "road-cell" | "self" | "reserve" | "passive";

export interface PropConfig {
  id: number;
  key: string;
  name: string;
  intro: string;
  price: number;
  cooldownMs: number;
  rarity: PropRarity;
  target: PropTarget | "supply" | "outside-battle";
  /** 安装包字段 ja/Ha，保留为原始配置合同，不擅自解释成别的经济系统。 */
  ja?: number;
  ha?: number;
  levels?: readonly number[];
  levelValues?: readonly number[];
  upgradePrices?: readonly number[];
  upgradeJa?: readonly number[];
  upgradeHa?: readonly number[];
}

/** 1.0.9 安装包 25 项道具原表；主动栏仅 ACTIVE_PROP_IDS，被动栏仅 PASSIVE_PROP_IDS。 */
export const PROPS: readonly PropConfig[] = [
  { id: 0, key: "shovel", name: "铲子", intro: "一把可以开荒的铲子", price: 999, cooldownMs: 0, rarity: 3, target: "supply" },
  { id: 1, key: "bulldozer", name: "推土车", intro: "将敌人向后推，阿斗安全无忧", price: 999, cooldownMs: 0, rarity: 3, target: "supply" },
  { id: 2, key: "writingBrush", name: "毛笔", intro: "可以逆天改字", price: 50, cooldownMs: 30_000, rarity: 2, target: "own-unit", ja: 10, ha: 12 },
  { id: 3, key: "trainingSpell", name: "练兵符", intro: "拖到单位上有概率升一级或降一级", price: 60, cooldownMs: 65_000, rarity: 2, target: "own-unit", ja: 8, ha: 8 },
  { id: 4, key: "upLvlSpell", name: "神兵符", intro: "拖到单位上升一级", price: 90, cooldownMs: 55_000, rarity: 3, target: "own-unit", ja: 5, ha: 3 },
  { id: 5, key: "lifePill", name: "包子", intro: "55%概率给阿斗续一条命，45%概率减少一条命", price: 50, cooldownMs: 90_000, rarity: 1, target: "self", ja: 10, ha: 12 },
  { id: 6, key: "longRange", name: "御敌千里", intro: "使目标单位攻击范围翻倍，全局生效", price: 30, cooldownMs: 60_000, rarity: 0, target: "own-unit", ja: 20, ha: 25 },
  { id: 7, key: "inkstone", name: "砚台", intro: "半径1.5格内敌方部队攻速-20%，持续5秒", price: 30, cooldownMs: 90_000, rarity: 0, target: "enemy-area", ja: 20, ha: 25 },
  { id: 8, key: "trap", name: "陷阱", intro: "首名踩中的敌人眩晕5秒", price: 35, cooldownMs: 50_000, rarity: 0, target: "road-cell", ja: 15, ha: 20 },
  { id: 9, key: "landmine", name: "地雷", intro: "首名踩中的敌人引爆地雷", price: 50, cooldownMs: 55_000, rarity: 1, target: "road-cell", ja: 10, ha: 12 },
  { id: 10, key: "attSpeedSpell", name: "攻速符", intro: "目标单位攻速+40%，全局生效", price: 80, cooldownMs: 90_000, rarity: 2, target: "own-unit", ja: 6, ha: 4 },
  { id: 11, key: "exorcismSpell", name: "降妖符", intro: "Boss施法有50%失败率，并反噬Boss自身血量", price: 80, cooldownMs: -1, rarity: 2, target: "passive", ja: 6, ha: 4 },
  { id: 12, key: "farmer", name: "农民", intro: "每30秒刷出农民；Lv1–5按20/10/5/3/2秒生产1馒头", price: 90, cooldownMs: -1, rarity: 2, target: "passive", ja: 5, ha: 3 },
  { id: 13, key: "recruit", name: "招贤榜", intro: "牌库中的每一份武将姓名字各有50%概率追加一份", price: 90, cooldownMs: -1, rarity: 2, target: "passive", ja: 8, ha: 8 },
  { id: 14, key: "allAttSpeedSpell", name: "攻速符(全体)", intro: "双方所有单位攻速+10%，全局生效", price: 60, cooldownMs: -1, rarity: 1, target: "passive", ja: 8, ha: 8 },
  { id: 15, key: "goingHandInHand", name: "齐头并进", intro: "我方攻速+50%，对方攻速+30%，全局生效", price: 90, cooldownMs: -1, rarity: 2, target: "passive", ja: 5, ha: 3 },
  { id: 16, key: "xuMingPill", name: "续命丹", intro: "我方阿斗+5条命，对方阿斗+3条命", price: 50, cooldownMs: -1, rarity: 0, target: "passive", ja: 10, ha: 12 },
  { id: 17, key: "daBuPill", name: "大补丸", intro: "我方阿斗+3条命", price: 40, cooldownMs: -1, rarity: 0, target: "passive", ja: 12, ha: 15 },
  { id: 18, key: "silt", name: "淤泥", intro: "我方道路上的敌人移速-10%，全局生效", price: 40, cooldownMs: -1, rarity: 0, target: "passive", ja: 12, ha: 15 },
  { id: 19, key: "superShovel", name: "洛阳铲", intro: "每60秒生成一个铲子", price: 120, cooldownMs: -1, rarity: 3, target: "passive", ja: 3, ha: 1 },
  { id: 20, key: "meteor", name: "陨石", intro: "敌人接近阿斗时落下陨石消灭敌人；冷却5分钟", price: 150, cooldownMs: -1, rarity: 3, target: "passive", ja: 2, ha: 1 },
  { id: 21, key: "trashCan", name: "垃圾桶", intro: "回收一枚营地文字，获得1馒头", price: 150, cooldownMs: 0, rarity: 3, target: "reserve", ja: 2, ha: 1 },
  { id: 22, key: "promotionOrder", name: "升职令", intro: "新征士兵有5%/10%/15%概率升为2级", price: 100, cooldownMs: -1, rarity: 1, target: "passive", ja: 8, ha: 5, levels: [1, 2, 3], levelValues: [5, 10, 15], upgradePrices: [100, 100, 150], upgradeJa: [8, 5, 3], upgradeHa: [5, 3, 2] },
  { id: 23, key: "marchPill", name: "行军丹", intro: "体力+10", price: 40, cooldownMs: 0, rarity: 0, target: "outside-battle", ja: 12, ha: 15 },
  { id: 24, key: "goldSeeker", name: "摸金校尉", intro: "让所有铲子变成金铲子，铲出宝箱", price: 150, cooldownMs: -1, rarity: 3, target: "passive", ja: 2, ha: 1 },
] as const;

export interface PropEffectConfig {
  kind: string;
  verification: RuleVerificationStatus;
  evidenceRefs: readonly string[];
  [field: string]: unknown;
}

/**
 * 道具效果的机器可读权威配置。intro 只用于展示，不得从文案反解析规则值。
 * pending-original-verification 项可供当前实现保持兼容，但不能据此宣称原包已完成可复核冻结。
 */
export const PROP_EFFECTS = {
  0: {
    kind: "unlock-grass",
    verification: "package-recorded",
    evidenceRefs: ["PROPS-MD#prop-0", "ORIGINAL-1.0.9#Dn.SY"],
    eligibleCellCodePrefix: "2",
    adjacencyRequired: false,
    consumeOnSuccess: true,
  },
  1: {
    kind: "push-enemies-toward-spawn",
    verification: "package-recorded",
    evidenceRefs: ["PROPS-MD#prop-1", "ORIGINAL-1.0.9#Mh.gA", "ORIGINAL-1.0.9#_s.back"],
    speedPxPerSec: 50,
    startPathOffsetFromEnd: 2,
    maximumReversePathNodes: 12,
    collisionRadiusPx: 40,
    withinCellOffsetClampPx: 39,
    endpointFadeMs: 5_000,
  },
  2: {
    kind: "reroll-unit-kind",
    verification: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#prop-2"],
    preserveLevel: true,
    preservePosition: true,
    excludeCurrentKind: true,
    excludedKinds: ["铲子"],
    sourcePool: "current-recruitment-pool",
  },
  3: {
    kind: "probabilistic-level-change",
    verification: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#prop-3"],
    outcomes: [
      { levelMin: 1, levelMax: 2, upChance: 1, downChance: 0 },
      { levelMin: 3, levelMax: 3, upChance: 0.7, downChance: 0.3 },
      { levelMin: 4, levelMax: null, upChance: 0.6, downChance: 0.4 },
    ],
  },
  4: {
    kind: "level-change",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-4"],
    delta: 1,
    clampToUnitMaxLevel: true,
  },
  5: {
    kind: "adou-random-hp-change",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-5"],
    outcomes: [{ delta: 1, chance: 0.55 }, { delta: -1, chance: 0.45 }],
    charges: 10,
  },
  6: {
    kind: "permanent-range-multiplier",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-6", "ORIGINAL-1.0.9#Dh.NP"],
    multiplier: 2,
    eligibleUnitKinds: ["弓", "all-generals"],
  },
  7: {
    kind: "temporary-enemy-attack-speed-multiplier",
    verification: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#prop-7"],
    radiusCells: 1.5,
    multiplier: 0.8,
    durationMs: 5_000,
  },
  8: {
    kind: "single-use-road-trap",
    verification: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#prop-8"],
    stunMs: 5_000,
    consumeOnFirstTrigger: true,
  },
  9: {
    kind: "single-use-road-landmine",
    verification: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#prop-9"],
    blastRadiusPx: 60,
    blastRadiusCells: 0.75,
    result: "instant-kill",
    consumeOnFirstTrigger: true,
  },
  10: {
    kind: "permanent-attack-speed-multiplier",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-10"],
    multiplier: 1.4,
  },
  11: {
    kind: "boss-spell-failure",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-11", "ORIGINAL-1.0.9#ie.gE"],
    failureChance: 0.5,
    backlashMaxHpFraction: { minInclusive: 0.1, maxExclusive: 0.2 },
  },
  12: {
    kind: "farmer-production",
    verification: "package-recorded",
    evidenceRefs: ["PROPS-MD#prop-12", "ORIGINAL-1.0.9#_h.BP"],
    spawnIntervalMs: 30_000,
    destinationPriority: ["open-deployment-cell", "reserve"],
    incomeIntervalByLevelMs: [20_000, 10_000, 5_000, 3_000, 2_000],
    incomeBuns: 1,
  },
  13: {
    kind: "recruit-name-weight-bonus",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-13", "ORIGINAL-1.0.9#on.TE"],
    perNameIndependentCopyChance: 0.5,
    copyWeightMultiplier: 2,
    consumeDrawnNameFromPersistentPool: true,
    removeOneAdditionalMatchingCopyAfterBoost: true,
  },
  14: {
    kind: "both-sides-attack-speed-bonus",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-14"],
    ownerBonus: 0.1,
    opponentBonus: 0.1,
  },
  15: {
    kind: "asymmetric-both-sides-attack-speed-bonus",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-15"],
    ownerBonus: 0.5,
    opponentBonus: 0.3,
  },
  16: {
    kind: "both-sides-adou-hp-bonus",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-16"],
    ownerHp: 5,
    opponentHp: 3,
  },
  17: {
    kind: "owner-adou-hp-bonus",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-17"],
    ownerHp: 3,
  },
  18: {
    kind: "enemy-move-speed-multiplier-on-owner-road",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-18"],
    multiplier: 0.9,
  },
  19: {
    kind: "periodic-shovel",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-19"],
    intervalMs: 60_000,
    amount: 1,
  },
  20: {
    kind: "near-adou-meteor",
    verification: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#prop-20"],
    cooldownMs: 300_000,
    lastRouteCells: 6,
    meteorsPerCell: { min: 1, max: 2 },
    impactRadiusCells: 1,
    result: "instant-kill",
  },
  21: {
    kind: "reserve-recycle",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-21"],
    buns: 1,
  },
  22: {
    kind: "recruited-soldier-promotion",
    verification: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-22"],
    eligibleKinds: ["刀", "弓", "枪", "骑"],
    chanceByLevel: [0.05, 0.1, 0.15],
    promotedLevel: 2,
  },
  23: {
    kind: "outside-battle-stamina",
    verification: "package-recorded",
    evidenceRefs: ["PROPS-MD#prop-23"],
    amount: 10,
    consumedImmediately: true,
  },
  24: {
    kind: "golden-shovel-treasure",
    verification: "package-recorded",
    evidenceRefs: ["PROPS-MD#prop-24", "ORIGINAL-1.0.9#Qh", "ORIGINAL-1.0.9#wg"],
    goldenAppearance: true,
    trigger: "every-successful-shovel-use",
    reward: { currency: "buns", min: 1, max: 10, distribution: "uniform-integer" },
    rewardDelayMs: 300,
    perCoinVisualIntervalMs: 100,
  },
} as const satisfies Record<number, PropEffectConfig>;

export const ACTIVE_PROP_IDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 21] as const satisfies readonly ActivePropId[];
export const PASSIVE_PROP_IDS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24] as const satisfies readonly PassivePropId[];
export const PROP_RARITY_NAMES = ["稀有", "卓越", "史诗", "传说"] as const;
export const PROP_RARITY_COLORS = ["#95e45a", "#2dddff", "#D955FF", "#E99431"] as const;
export function propConfig(id: number) { return PROPS.find((prop) => prop.id === id); }

export const PROP_ACQUISITION_RULES = {
  loadout: {
    activeLimit: 2,
    passiveLimit: 6,
    duplicatesAllowed: false,
    activeIds: ACTIVE_PROP_IDS,
    passiveIds: PASSIVE_PROP_IDS,
  },
  inBattleShovelSupply: {
    originalTrigger: {
      allInitialOpenCellsOccupied: true,
      reserveContainsShovel: false,
      reserveRequiresFreeSlot: true,
      maxShovels: 2,
      firstUseFree: true,
      laterUsesRequireAd: true,
    },
    webAdaptation: {
      directGrant: true,
      maxClaimsPerMatch: 1,
      maxShovels: 2,
      consumeClaimWhenReserveFull: false,
    },
  },
  settlement: {
    originalBaseCoins: { victory: 20, defeat: 5 },
    originalAdMultiplier: 2,
    webAdReplacement: "direct-double-claim",
  },
  postMatchShop: {
    offerCount: 3,
    selection: "uniform-without-replacement-from-obtainable-props",
    perOfferOriginalAdChance: 0.1,
    webAdReplacement: "direct-free-claim",
  },
  roulette: {
    candidateCount: 8,
    candidateSelection: "weighted-without-replacement",
    candidateWeightField: "ja",
    winnerWeightField: "ha",
    originalEntry: "ad-or-share",
    webEntry: "direct-draw",
    webDrawsPerPostMatchShop: 1,
  },
  dailyReset: {
    timeZone: "Asia/Shanghai",
    reset: ["daily-props", "daily-win-loss-counts"],
    preserve: ["coins"],
  },
} as const;

export const WAVES = [
  [10, 10], [11, 16], [12, 26], [13, 41], [15, 61], [16, 92], [18, 138], [19, 200],
  [21, 291], [24, 421], [26, 611], [29, 886], [31, 1285], [35, 1863], [38, 2701],
  [42, 3917], [46, 5680], [51, 8235], [56, 11941], [61, 17315],
] as const;

export const DIFFICULTY_CURVES = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1.1,1.2,1.3,1.2,1.3,1.7,2,1,1.5,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1.5,1,1.8,2,1,1,2,1,1,1.3,1,1,1.4,1,1,1.5,1,1],
] as const;
export const DIFFICULTY_WEIGHTS = [5, 2, 3] as const;
export const BOSS_MILESTONES = [3, 6, 9, 12, 15, 18] as const;
export const BOSS_CHANCES = [0.1, 0.2, 0.3, 0.5, 0.9, 1] as const;
export const NORMAL_ENEMY_SPEED_PX_PER_SEC = 50;
export const BOSS_ENEMY_SPEED_PX_PER_SEC = 10;
/** 原包新手前十局、且仅前十波使用；下标为从 0 开始的对局 round。 */
export const INTRO_ROUND_HP_MULTIPLIERS = [0.6, 0.6, 0.6, 0.6, 0.7, 0.7, 0.7, 0.8, 0.8, 0.8] as const;

export const BOSS_CONFIGS = [
  { name: "摄魂", hpMultiplier: 7, speedPxPerSec: 10, range: 2, cooldownMs: 8_000, intro: "使我方小兵陷入混乱，无法攻击", color: "#ed462f" },
  { name: "招魂", hpMultiplier: 10, speedPxPerSec: 10, range: 3, cooldownMs: 8_000, intro: "做法复活死亡的小兵", color: "#32ee3a" },
  { name: "鼓舞", hpMultiplier: 14, speedPxPerSec: 10, range: 2, cooldownMs: 10_000, intro: "激励身边单位，大幅提升血量和移速", color: "#27c8ff" },
  { name: "拆迁", hpMultiplier: 7, speedPxPerSec: 10, range: 10, cooldownMs: 10_000, intro: "将空白地块转化为不可用", color: "#f16fe1" },
  { name: "巫山云雨", hpMultiplier: 10, speedPxPerSec: 10, range: 10, cooldownMs: 3_000, intro: "战场下雨，降低所有单位攻速，升级可驱除", color: "#68b4ff" },
  { name: "裙下之臣", hpMultiplier: 14, speedPxPerSec: 10, range: 10, cooldownMs: 10_000, intro: "将最低等级的小兵纳入麾下", color: "#d9207a" },
  { name: "铁骑号令", hpMultiplier: 7, speedPxPerSec: 10, range: 0, cooldownMs: 8_000, intro: "召唤西凉骑兵", color: "#4db678" },
  { name: "方天画戟", hpMultiplier: 10, speedPxPerSec: 10, range: 2.5, cooldownMs: 10_000, intro: "挥动武器，大幅降低小兵等级并禁止合成", color: "#fb4c54" },
  { name: "饕餮", hpMultiplier: 14, speedPxPerSec: 10, range: 1.5, cooldownMs: 10_000, intro: "吞噬范围内小兵，获得血量加成并膨胀", color: "#7447a6" },
  { name: "彻底疯狂", hpMultiplier: 7, speedPxPerSec: 10, range: 2, cooldownMs: 15_000, intro: "冲阵击倒小兵，使其无法动弹，升级解除", color: "#fb2500" },
  { name: "噬目", hpMultiplier: 10, speedPxPerSec: 10, range: 2, cooldownMs: 8_000, intro: "视野变暗，难以看清局势", color: "#21b2ff" },
  { name: "一代枭雄", hpMultiplier: 14, speedPxPerSec: 10, range: 10, cooldownMs: 15_000, intro: "封印最高等级小兵，升级解除", color: "#010b97" },
] as const;

/** 原包 1.0.9 Boss 技能的机器可读合同；动画停止型时长只控制表现，不改已核定结算点。 */
export const BOSS_SKILL_RULES = [
  { key: "soul-sweep", effectWindowMs: [500, 1400], pulseMs: 100, chaosMs: 2_000, radiusCells: 2 },
  { key: "resurrection", maximumRevives: 3, target: "normal-enemy-death-in-range", summonedKind: "zombie" },
  { key: "inspire", delayMs: 500, durationMs: 5_000, scaleBonus: 0.2, hpBonus: 0.5, moveSpeedBonus: 0.3 },
  { key: "demolition", delayMs: 500, target: "uniform-random-empty-deployment-cell", result: "locked-grass" },
  { key: "rain", attackSpeedBonus: -0.2, duration: "until-boss-death", dispel: "unit-upgrade" },
  { key: "charm", target: "all-minimum-level-soldiers", maximumEligibleLevel: 3, summonedKind: "puppet", pathIndexOffset: [-1, 1] },
  { key: "cavalry-order", summonedKind: "cavalry", count: 1 },
  { key: "halberd-suppression", delayMs: 650, durationMs: 5_000, temporaryLevel: 1, preventsMerge: true },
  { key: "devour", delayMs: 500, hpPerTargetCurrentWaveMultiplier: 2, scalePerTarget: 0.01 },
  { key: "knockdown", target: "uniform-random-unit-in-range", impactOffsetCells: 0.75, runDurationMsPerPixel: 3, dispel: "unit-upgrade" },
  { key: "darkness", delayMs: 1_000, durationMs: 5_000 },
  { key: "seal", target: "highest-level-soldier", belowMaxDurationMs: -1, maxLevelDurationMs: 10_000, dispel: "unit-upgrade" },
] as const;

export interface MapLayout {
  name: string;
  /** 安装包原格式为 [x][y]。 */
  cells: readonly (readonly MapCode[])[];
  /** 己方（下半场）敌军行军路线，坐标为格子中心。 */
  path: readonly (readonly [number, number])[];
}

export const MAP_LAYOUTS: readonly MapLayout[] = [
  { name: "巨鹿", cells: [
    ["0_1","0_1","0_1","0_1","0_1","0_1","0_0","0_0","0_0","0_0"],
    ["2_1","2_1","2_1","2_1","2_1","0_1","0_0","2_0","2_0","2_0"],
    ["2_1","2_1","2_1","2_1","2_1","0_1","0_0","1_0","1_0","2_0"],
    ["2_1","1_1","1_1","0_1","0_1","0_1","0_0","1_0","1_0","2_0"],
    ["2_1","1_1","1_1","0_1","0_0","0_0","0_0","1_0","1_0","2_0"],
    ["2_1","1_1","1_1","0_1","0_0","2_0","2_0","2_0","2_0","2_0"],
    ["2_1","2_1","2_1","0_1","0_0","2_0","2_0","2_0","2_0","2_0"],
    ["0_1","0_1","0_1","0_1","0_0","0_0","0_0","0_0","0_0","0_0"],
  ], path: [[0,9],[0,6],[4,6],[4,4],[7,4],[7,9]] },
  { name: "云梦泽", cells: [
    ["0_1","0_1","0_1","0_1","0_1","2_0","0_0","0_0","0_0","0_0"],
    ["2_1","2_1","2_1","2_1","0_1","2_0","0_0","2_0","2_0","2_0"],
    ["2_1","2_1","2_1","2_1","0_1","2_0","0_0","1_0","1_0","2_0"],
    ["2_1","1_1","1_1","0_1","0_1","2_0","0_0","1_0","1_0","2_0"],
    ["2_1","1_1","1_1","0_1","2_1","0_0","0_0","1_0","1_0","2_0"],
    ["2_1","1_1","1_1","0_1","2_1","0_0","2_0","2_0","2_0","2_0"],
    ["2_1","2_1","2_1","0_1","2_1","0_0","2_0","2_0","2_0","2_0"],
    ["0_1","0_1","0_1","0_1","2_1","0_0","0_0","0_0","0_0","0_0"],
  ], path: [[0,9],[0,6],[4,6],[4,5],[7,5],[7,9]] },
  { name: "虎牢关", cells: [
    ["2_1","0_1","0_1","0_1","0_1","0_0","0_0","0_0","0_0","2_0"],
    ["2_1","0_1","2_1","2_1","2_1","2_0","2_0","2_0","0_0","2_0"],
    ["0_1","0_1","2_1","2_1","2_1","2_0","1_0","1_0","0_0","2_0"],
    ["0_1","2_1","1_1","1_1","2_1","2_0","1_0","1_0","0_0","0_0"],
    ["0_1","0_1","1_1","1_1","2_1","2_0","1_0","1_0","2_0","0_0"],
    ["2_1","0_1","1_1","1_1","2_1","2_0","2_0","2_0","0_0","0_0"],
    ["2_1","0_1","2_1","2_1","2_1","2_0","2_0","2_0","0_0","2_0"],
    ["2_1","0_1","0_1","0_1","0_1","0_0","0_0","0_0","0_0","2_0"],
  ], path: [[0,5],[0,8],[3,8],[3,9],[5,9],[5,8],[7,8],[7,5]] },
  { name: "赤壁", cells: [
    ["2_1","0_1","0_1","0_1","0_1","0_0","0_0","0_0","0_0","2_0"],
    ["2_1","0_1","2_1","2_1","2_1","2_0","2_0","2_0","0_0","2_0"],
    ["2_1","0_1","0_1","0_1","0_1","0_0","0_0","0_0","0_0","2_0"],
    ["1_1","1_1","1_1","2_1","0_1","0_0","2_0","1_0","1_0","1_0"],
    ["1_1","1_1","1_1","2_1","0_1","0_0","2_0","1_0","1_0","1_0"],
    ["2_1","0_1","0_1","0_1","0_1","0_0","0_0","0_0","0_0","2_0"],
    ["2_1","0_1","2_1","2_1","2_1","2_0","2_0","2_0","0_0","2_0"],
    ["2_1","0_1","0_1","0_1","0_1","0_0","0_0","0_0","0_0","2_0"],
  ], path: [[0,5],[0,8],[2,8],[2,5],[5,5],[5,8],[7,8],[7,5]] },
] as const;

export function cellIndex(x: number, y: number) { return y * GAME_CONFIG.columns + x; }
export function cellCoords(cell: number) { return { x: cell % GAME_CONFIG.columns, y: Math.floor(cell / GAME_CONFIG.columns) }; }
export function cellCode(mapIndex: number, cell: number): MapCode {
  const { x, y } = cellCoords(cell);
  return MAP_LAYOUTS[mapIndex]?.cells[x]?.[y] ?? "2_0";
}
export function initialOpenCells(mapIndex: number) {
  const result: number[] = [];
  for (let y = 0; y < GAME_CONFIG.rows; y += 1) for (let x = 0; x < GAME_CONFIG.columns; x += 1) {
    const cell = cellIndex(x, y);
    if (cellCode(mapIndex, cell) === "1_0") result.push(cell);
  }
  return result;
}
export function pathLengthCells(mapIndex: number) {
  const points = MAP_LAYOUTS[mapIndex]?.path ?? MAP_LAYOUTS[0]!.path;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!; const b = points[i]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}
export function pathPoint(mapIndex: number, progress: number) {
  const points = MAP_LAYOUTS[mapIndex]?.path ?? MAP_LAYOUTS[0]!.path;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!; const b = points[i]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]); lengths.push(total);
  }
  const distance = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 1; i < points.length; i += 1) {
    const end = lengths[i - 1]!; const start = i === 1 ? 0 : lengths[i - 2]!;
    if (distance <= end) {
      const a = points[i - 1]!; const b = points[i]!;
      const t = (distance - start) / Math.max(0.0001, end - start);
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
    }
  }
  const last = points[points.length - 1]!;
  return { x: last[0], y: last[1] };
}

/**
 * 规则消费者的新入口。旧的具名导出继续保留以保持兼容；新增消费者应从此对象读取，
 * 并在快照/存档中同时记录 rulesetVersion 与 schemaVersion。
 */
export const RULES_CONFIG_1_0_9 = {
  rulesetVersion: RULESET_VERSION,
  schemaVersion: RULES_CONFIG_SCHEMA_VERSION,
  evidence: RULE_EVIDENCE_SOURCES,
  provenance: RULE_PROVENANCE,
  battle: GAME_CONFIG,
  recruitment: RECRUITMENT_RULES,
  merge: MERGE_RULES,
  attackRange: ATTACK_RANGE_RULES,
  units: {
    soldiers: SOLDIERS,
    generals: GENERALS,
    soldierLevelAttackMultipliers: SOLDIER_LEVEL_ATTACK,
    soldierLevelSpeedMultipliers: SOLDIER_LEVEL_SPEED,
    generalLevelAttackMultipliers: GENERAL_LEVEL_ATTACK,
    generalLevelSpeedMultipliers: GENERAL_LEVEL_SPEED,
    generalExperience: GENERAL_EXPERIENCE,
  },
  props: {
    catalog: PROPS,
    effects: PROP_EFFECTS,
    acquisition: PROP_ACQUISITION_RULES,
    rarityNames: PROP_RARITY_NAMES,
    rarityColors: PROP_RARITY_COLORS,
  },
  battleBuffs: {
    catalog: BATTLE_BUFFS,
    drop: BATTLE_BUFF_DROP,
  },
  waves: {
    rows: WAVES,
    difficultyCurves: DIFFICULTY_CURVES,
    difficultyWeights: DIFFICULTY_WEIGHTS,
    bossMilestones: BOSS_MILESTONES,
    bossChances: BOSS_CHANCES,
    normalSpeedPxPerSec: NORMAL_ENEMY_SPEED_PX_PER_SEC,
    introRoundHpMultipliers: INTRO_ROUND_HP_MULTIPLIERS,
    bossConfigs: BOSS_CONFIGS,
    bossSkills: BOSS_SKILL_RULES,
  },
  maps: MAP_LAYOUTS,
} as const;
