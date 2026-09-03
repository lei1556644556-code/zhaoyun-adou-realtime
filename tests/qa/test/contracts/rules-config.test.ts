import { describe, expect, it } from "vitest";
import {
  ACTIVE_PROP_IDS, GAME_CONFIG, GENERALS, HERO_PAIRS, MAP_LAYOUTS, PASSIVE_PROP_IDS, PROPS, SOLDIERS, WAVES,
} from "@adou/shared";
import { contractNumber, markdownRows, propsBaseline, rulesBaseline, section } from "../helpers/contracts";

describe("1.0.9 public rules/config contract", () => {
  it("matches the documented opening, board, wave, and economy values", () => {
    expect(GAME_CONFIG.designWidth).toBe(contractNumber(/设计分辨率：(\d+)×\d+/));
    expect(GAME_CONFIG.designHeight).toBe(contractNumber(/设计分辨率：\d+×(\d+)/));
    expect(GAME_CONFIG.columns).toBe(contractNumber(/共用战场：(\d+) 列×\d+ 行/));
    expect(GAME_CONFIG.rows).toBe(contractNumber(/共用战场：\d+ 列×(\d+) 行/));
    expect(GAME_CONFIG.baseHp).toBe(contractNumber(/初始阿斗生命：(\d+)/));
    expect(GAME_CONFIG.startBuns).toBe(contractNumber(/初始馒头：(\d+)/));
    expect(GAME_CONFIG.recruitBase).toBe(contractNumber(/初始征兵价格：(\d+)/));
    expect(GAME_CONFIG.recruitStep).toBe(contractNumber(/每次征兵后下一次价格 \+(\d+)/));
    expect(GAME_CONFIG.maxWaves).toBe(contractNumber(/共 (\d+) 波/));
    expect(GAME_CONFIG.normalKillBuns).toBe(contractNumber(/普通敌人击杀奖励：(\d+) 馒头/));
    expect(GAME_CONFIG.bossKillBuns).toBe(contractNumber(/Boss 击杀奖励：(\d+) 馒头/));
    expect(GAME_CONFIG.hpLostBuns).toBe(contractNumber(/阿斗 -1 生命，同时玩家 \+(\d+) 馒头/));
  });

  it("matches every documented soldier row", () => {
    const rows = markdownRows(section(rulesBaseline, "## 4. 基础兵种数值", "## 5. 武将数值"));
    const contract = rows.slice(1).filter((row) => typeof row[0] === "string" && row[0] in SOLDIERS);
    expect(contract).toHaveLength(Object.keys(SOLDIERS).length);
    for (const [kind, attack, interval, range, form, target] of contract) {
      const actual = SOLDIERS[kind as keyof typeof SOLDIERS];
      expect(actual).toMatchObject({
        attack: Number(attack), intervalMs: Number.parseFloat(interval ?? "") * 1_000,
        range: Number(range), form, target,
      });
    }
  });

  it("matches every documented general and fusion pair", () => {
    const heroRows = markdownRows(section(rulesBaseline, "## 5. 武将数值", "## 6. 波次与经济"));
    const heroContract = heroRows.slice(1).filter((row) => typeof row[0] === "string" && row[0] in GENERALS);
    expect(heroContract).toHaveLength(Object.keys(GENERALS).length);
    for (const [name, weapon, attack, interval, range, maxLevel] of heroContract) {
      expect(GENERALS[name!]).toMatchObject({
        weapon, attack: Number(attack), intervalMs: Number.parseFloat(interval ?? "") * 1_000,
        range: Number(range), maxLevel: Number(maxLevel),
      });
    }

    const fusionRows = markdownRows(section(rulesBaseline, "## 3. 拖放、开放格与合成", "## 4. 基础兵种数值"));
    const pairs = fusionRows.slice(1).flatMap((row) => [[row[0], row[1]], [row[2], row[3]]] as const)
      .filter((pair): pair is readonly [string, string] => Boolean(pair[0] && pair[1]));
    expect(pairs).toHaveLength(12);
    for (const [pair, hero] of pairs) {
      const compact = pair.replace(/\s/g, "");
      expect(HERO_PAIRS[compact]).toBe(hero);
      expect(HERO_PAIRS[compact.split("+").reverse().join("+")]).toBe(hero);
    }
  });

  it("matches all twenty documented wave count/health pairs", () => {
    const rows = markdownRows(section(rulesBaseline, "## 6. 波次与经济", "## 7. 地图"));
    const documented = rows.slice(1).flatMap((row) => [
      [Number(row[0]), Number(row[1]), Number(row[2])] as [number, number, number],
      [Number(row[3]), Number(row[4]), Number(row[5])] as [number, number, number],
    ]).filter((row): row is [number, number, number] => Number.isInteger(row[0]) && row[0] > 0)
      .sort((a, b) => a[0] - b[0]);
    expect(documented).toHaveLength(20);
    expect(WAVES.map(([count, hp], index) => [index + 1, count, hp])).toEqual(documented);
  });

  it("keeps the four documented 8x10 maps and the complete prop catalog", () => {
    expect(MAP_LAYOUTS.map((map) => map.name)).toEqual(["巨鹿", "云梦泽", "虎牢关", "赤壁"]);
    for (const map of MAP_LAYOUTS) {
      expect(map.cells).toHaveLength(GAME_CONFIG.columns);
      expect(map.cells.every((column) => column.length === GAME_CONFIG.rows)).toBe(true);
    }
    const propRows = markdownRows(section(propsBaseline, "## 2. 完整原表和效果", "## 3. 实时对战实现映射"));
    const documented = propRows.slice(1).filter((row) => /^\d+$/.test(row[0] ?? ""));
    expect(documented).toHaveLength(25);
    expect(PROPS.map(({ id, name }) => [id, name])).toEqual(documented.map((row) => [Number(row[0]), row[1]]));
    expect(ACTIVE_PROP_IDS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 21]);
    expect(PASSIVE_PROP_IDS).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24]);
  });
});
