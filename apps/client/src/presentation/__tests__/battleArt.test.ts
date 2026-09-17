import { describe, expect, it } from "vitest";
import { battleAttackStyle, EffectEventWindow, ultimateShape } from "../battleArt";

describe("battle art, independent from rules", () => {
  it("evicts only oldest effects without replaying overlapping snapshots", () => {
    const window = new EffectEventWindow(3);
    for (const id of ["a", "b", "c", "d"]) expect(window.accept(id)).toBe(true);
    for (const id of ["b", "c", "d"]) expect(window.accept(id)).toBe(false);
    expect(window.accept("a")).toBe(true);
    window.clear();
    expect(window.accept("d")).toBe(true);
  });
  it("uses distinct hero palettes and existing motion profiles", () => {
    expect(battleAttackStyle("赵云").color).not.toBe(battleAttackStyle("张飞").color);
    expect(battleAttackStyle("刘备").variant).toBe("slash");
    expect(battleAttackStyle("unknown")).toEqual(battleAttackStyle("刀"));
  });
  it("distinguishes shockwave, volley, crescent, thrust and charge", () => {
    expect(ultimateShape("张飞", "大喝")).toBe("shockwave");
    expect(ultimateShape("黄忠", "箭雨")).toBe("volley");
    expect(ultimateShape("关羽", "绝技")).toBe("crescent");
    expect(ultimateShape("赵云", "绝技")).toBe("thrust");
    expect(ultimateShape("马超", "绝技")).toBe("charge");
  });
});
