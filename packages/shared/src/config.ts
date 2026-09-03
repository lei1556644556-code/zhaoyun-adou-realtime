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

/** 安装包的新号前三日会在基础池额外塞入两枚铲子：11/109 -> 13/111。 */
export const EARLY_ACCOUNT_SHOVEL_BONUS = 2;

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

export const HERO_PAIRS: Record<string, string> = {
  "云+赵": "赵云", "赵+云": "赵云", "张+飞": "张飞", "飞+张": "张飞",
  "马+超": "马超", "超+马": "马超", "关+羽": "关羽", "羽+关": "关羽",
  "关+平": "关平", "平+关": "关平", "关+兴": "关兴", "兴+关": "关兴",
  "张+苞": "张苞", "苞+张": "张苞", "张+翼": "张翼", "翼+张": "张翼",
  "黄+忠": "黄忠", "忠+黄": "黄忠", "黄+盖": "黄盖", "盖+黄": "黄盖",
  "黄+祖": "黄祖", "祖+黄": "黄祖", "刘+备": "刘备", "备+刘": "刘备",
};

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

export const ACTIVE_PROP_IDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 21] as const satisfies readonly ActivePropId[];
export const PASSIVE_PROP_IDS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24] as const satisfies readonly PassivePropId[];
export const PROP_RARITY_NAMES = ["稀有", "卓越", "史诗", "传说"] as const;
export const PROP_RARITY_COLORS = ["#95e45a", "#2dddff", "#D955FF", "#E99431"] as const;
export function propConfig(id: number) { return PROPS.find((prop) => prop.id === id); }

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
