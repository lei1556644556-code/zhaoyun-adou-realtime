/** 原作规则版本；与网络协议版本分开演进。 */
export const RULESET_VERSION = "1.0.9" as const;
export const RULES_CONFIG_SCHEMA_VERSION = "1.0.0" as const;

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
  extractor: { ref: "DCC-TOOL", path: "tools/extract-laya-dcc.cjs" },
} as const;

export const RULE_PROVENANCE = {
  openingAndBoard: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#2.1", "SPEC-DOCX#table-6", "RULES-MD#1"],
    note: "开局生命、馒头、棋盘尺寸与准备时间在候选取证记录中标为包体值。",
  },
  recruitmentPool: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-10", "RULES-MD#2"],
    note: "23 个条目的权重求和为 108。",
  },
  earlyAccountShovelBonus: {
    status: "pending-original-verification",
    evidenceRefs: ["RULES-MD#2"],
    note: "现实现记录前三日额外 +2 铲子权重，但仓库没有对应原包代码片段。",
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
    evidenceRefs: ["RULES-MD#3"],
    note: "两格占用、中心射程与拆字流程未在随库包体证据中定位。",
  },
  soldierAndGeneralStats: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-11", "SPEC-DOCX#table-12", "SPEC-DOCX#table-14"],
    note: "攻击、间隔、射程、等级倍率与武将上限有候选包体表记录。",
  },
  attackCollision: {
    status: "pending-original-verification",
    evidenceRefs: ["RULES-MD#4"],
    note: "d.Si 的减 1px 圆矩形判定缺少随库代码摘录或固定输入输出证据。",
  },
  wavesAndBossChance: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-21", "SPEC-DOCX#table-22", "RULES-MD#6"],
    note: "20 波数量/生命、难度曲线与 Boss 里程碑概率有候选包体表记录。",
  },
  propsCatalog: {
    status: "package-recorded",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#2"],
    note: "25 行原始字段表有候选包体记录。",
  },
  propRuntimeDetails: {
    status: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#2", "PROPS-MD#5"],
    note: "精确半径、概率分支、生成条件等详情没有随库原包代码片段。",
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
  authoritativeTickRate: {
    status: "project-adaptation",
    evidenceRefs: ["RULES-MD#8", "SPEC-DOCX#9.5"],
    note: "10Hz 是当前实时实现选择；候选稿将服务器 tick 标为 RT_TBD。",
  },
} as const satisfies Record<string, RuleProvenanceEntry>;

export const GAME_CONFIG = {
  protocolVersion: "0.3.0",
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

/** 现有实现记录的新号前三日铲子加权；原包触发代码仍待随库证据复核。 */
export const EARLY_ACCOUNT_SHOVEL_BONUS = 2;
export const TOKEN_POOL_BASE_WEIGHT = TOKEN_POOL.reduce((sum, [, weight]) => sum + weight, 0);
export const TOKEN_POOL_SHOVEL_WEIGHT = TOKEN_POOL.reduce(
  (sum, [kind, weight]) => sum + (kind === "铲子" ? weight : 0), 0,
);
export const EARLY_ACCOUNT_TOKEN_POOL_WEIGHT = TOKEN_POOL_BASE_WEIGHT + EARLY_ACCOUNT_SHOVEL_BONUS;
export const EARLY_ACCOUNT_SHOVEL_WEIGHT = TOKEN_POOL_SHOVEL_WEIGHT + EARLY_ACCOUNT_SHOVEL_BONUS;

export const RECRUITMENT_RULES = {
  drawsPerRecruit: GAME_CONFIG.reserveSize,
  drawMode: "independent-with-replacement",
  basePool: TOKEN_POOL,
  baseWeightTotal: TOKEN_POOL_BASE_WEIGHT,
  earlyAccount: {
    eligibilityDays: 3,
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
    cellsMustBeOrthogonallyAdjacent: true,
    splitAnyPartToEmptyOpenCell: true,
  },
} as const;

export type HeroRarity = "gold" | "purple";

export const GENERALS: Record<string, {
  weapon: string; attack: number; intervalMs: number; range: number; maxLevel: number; rarity: HeroRarity; skill: string;
}> = {
  赵云: { weapon: "枪", attack: 2, intervalMs: 800, range: 2.5, maxLevel: 5, rarity: "gold", skill: "30次普攻后七进七出，往返突进7次" },
  张飞: { weapon: "枪", attack: 10, intervalMs: 1000, range: 2.5, maxLevel: 5, rarity: "gold", skill: "15次普攻后范围眩晕2秒" },
  马超: { weapon: "枪", attack: 10, intervalMs: 1000, range: 2.5, maxLevel: 5, rarity: "gold", skill: "普攻30%眩晕0.5秒；Boss 10%/0.2秒" },
  关羽: { weapon: "刀", attack: 20, intervalMs: 1000, range: 2.5, maxLevel: 5, rarity: "gold", skill: "20次普攻后连续5次跳斩，50%范围溅射" },
  黄忠: { weapon: "弓", attack: 6, intervalMs: 800, range: 4.5, maxLevel: 5, rarity: "gold", skill: "30次普攻后火箭烈，单箭2倍攻击" },
  关平: { weapon: "刀", attack: 3, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", skill: "15次普攻后范围眩晕1秒" },
  关兴: { weapon: "刀", attack: 7, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", skill: "10%概率眩晕普通敌人0.3秒" },
  张苞: { weapon: "枪", attack: 7, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", skill: "10%概率眩晕普通敌人0.3秒" },
  张翼: { weapon: "骑/剑", attack: 7, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", skill: "20次普攻后下一次跳斩，50%范围溅射" },
  黄盖: { weapon: "骑/剑", attack: 8, intervalMs: 1000, range: 2.5, maxLevel: 3, rarity: "purple", skill: "无额外武将技能" },
  刘备: { weapon: "骑/剑", attack: 10, intervalMs: 800, range: 2.5, maxLevel: 5, rarity: "gold", skill: "20次普攻后圣剑，5倍攻击并击倒" },
  黄祖: { weapon: "弓", attack: 6, intervalMs: 800, range: 3.5, maxLevel: 3, rarity: "purple", skill: "30次普攻后箭雨" },
};

export const LEVEL_ATTACK = [1, 1.5, 2.1, 2.73, 3.276] as const;
export const LEVEL_SPEED = [1, 1.3, 1.56, 1.794, 1.9734] as const;

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
  { id: 12, key: "farmer", name: "农民", intro: "每30秒刷出农民；农民每20秒+1馒头，升级生产速度翻倍", price: 90, cooldownMs: -1, rarity: 2, target: "passive", ja: 5, ha: 3 },
  { id: 13, key: "recruit", name: "招贤榜", intro: "每个武将姓名字独立50%追加一份权重（安装包实际算法）", price: 90, cooldownMs: -1, rarity: 2, target: "passive", ja: 8, ha: 8 },
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
    kind: "unlock-adjacent-grass",
    verification: "package-recorded",
    evidenceRefs: ["PROPS-MD#prop-0"],
    adjacency: "orthogonal",
    consumeOnSuccess: true,
  },
  1: {
    kind: "push-enemies-toward-spawn",
    verification: "pending-original-verification",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-1"],
    pushDistanceCells: null,
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
  },
  6: {
    kind: "permanent-range-multiplier",
    verification: "pending-original-verification",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-6"],
    multiplier: 2,
    eligibleUnitKinds: null,
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
    verification: "pending-original-verification",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-11"],
    failureChance: 0.5,
    backlash: "boss-self-life-unspecified",
  },
  12: {
    kind: "farmer-production",
    verification: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#prop-12"],
    spawnIntervalMs: 30_000,
    destinationPriority: ["open-deployment-cell", "reserve"],
    incomeIntervalMs: 20_000,
    incomeBuns: 1,
  },
  13: {
    kind: "recruit-name-weight-bonus",
    verification: "pending-original-verification",
    evidenceRefs: ["SPEC-DOCX#table-24", "PROPS-MD#prop-13"],
    perNameIndependentCopyChance: 0.5,
    copyWeightMultiplier: 2,
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
    verification: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#prop-23"],
    configuredTextAmount: 10,
    recordedRuntimeAmount: 1,
    consumedImmediately: true,
  },
  24: {
    kind: "golden-shovel-appearance",
    verification: "pending-original-verification",
    evidenceRefs: ["PROPS-MD#prop-24"],
    goldenAppearance: true,
    recordedRuntimeReward: null,
  },
} as const satisfies Record<number, PropEffectConfig>;

export const ACTIVE_PROP_IDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 21] as const satisfies readonly ActivePropId[];
export const PASSIVE_PROP_IDS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24] as const satisfies readonly PassivePropId[];
export const PROP_RARITY_NAMES = ["普通", "稀有", "卓越", "史诗"] as const;
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
    levelAttackMultipliers: LEVEL_ATTACK,
    levelSpeedMultipliers: LEVEL_SPEED,
  },
  props: {
    catalog: PROPS,
    effects: PROP_EFFECTS,
    acquisition: PROP_ACQUISITION_RULES,
    rarityNames: PROP_RARITY_NAMES,
    rarityColors: PROP_RARITY_COLORS,
  },
  waves: {
    rows: WAVES,
    difficultyCurves: DIFFICULTY_CURVES,
    difficultyWeights: DIFFICULTY_WEIGHTS,
    bossMilestones: BOSS_MILESTONES,
    bossChances: BOSS_CHANCES,
  },
  maps: MAP_LAYOUTS,
} as const;
