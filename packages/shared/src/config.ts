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

export const GENERALS: Record<string, {
  weapon: string; attack: number; intervalMs: number; range: number; maxLevel: number; skill: string;
}> = {
  赵云: { weapon: "枪", attack: 2, intervalMs: 800, range: 2.5, maxLevel: 5, skill: "30次普攻后七进七出，往返突进7次" },
  张飞: { weapon: "枪", attack: 10, intervalMs: 1000, range: 2.5, maxLevel: 5, skill: "15次普攻后范围眩晕2秒" },
  马超: { weapon: "枪", attack: 10, intervalMs: 1000, range: 2.5, maxLevel: 5, skill: "普攻30%眩晕0.5秒；Boss 10%/0.2秒" },
  关羽: { weapon: "刀", attack: 20, intervalMs: 1000, range: 2.5, maxLevel: 5, skill: "20次普攻后连续5次跳斩，50%范围溅射" },
  黄忠: { weapon: "弓", attack: 6, intervalMs: 800, range: 4.5, maxLevel: 5, skill: "30次普攻后火箭烈，单箭2倍攻击" },
  关平: { weapon: "刀", attack: 3, intervalMs: 1000, range: 2.5, maxLevel: 3, skill: "15次普攻后范围眩晕1秒" },
  关兴: { weapon: "刀", attack: 7, intervalMs: 1000, range: 2.5, maxLevel: 3, skill: "10%概率眩晕普通敌人0.3秒" },
  张苞: { weapon: "枪", attack: 7, intervalMs: 1000, range: 2.5, maxLevel: 3, skill: "10%概率眩晕普通敌人0.3秒" },
  张翼: { weapon: "骑/剑", attack: 7, intervalMs: 1000, range: 2.5, maxLevel: 3, skill: "20次普攻后下一次跳斩，50%范围溅射" },
  黄盖: { weapon: "骑/剑", attack: 8, intervalMs: 1000, range: 2.5, maxLevel: 3, skill: "无额外武将技能" },
  刘备: { weapon: "骑/剑", attack: 10, intervalMs: 800, range: 2.5, maxLevel: 5, skill: "20次普攻后圣剑，5倍攻击并击倒" },
  黄祖: { weapon: "弓", attack: 6, intervalMs: 800, range: 3.5, maxLevel: 3, skill: "30次普攻后箭雨" },
};

export const LEVEL_ATTACK = [1, 1.5, 2.1, 2.73, 3.276] as const;
export const LEVEL_SPEED = [1, 1.3, 1.56, 1.794, 1.9734] as const;

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
