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
  it("plays reused event IDs in a new match but not overlapping checkpoints in the same match", () => {
    const window = new EffectEventWindow();
    expect(window.accept("event-1", "演武场:11")).toBe(true);
    expect(window.accept("event-1", "演武场:11")).toBe(false);
    expect(window.accept("event-1", "演武场:12")).toBe(true);
    expect(window.accept("event-1", "演武场:12")).toBe(false);
  });
  it("distinguishes shockwave, volley, crescent, thrust and charge", () => {
    expect(ultimateShape("张飞", "大喝")).toBe("shockwave");
    expect(ultimateShape("黄忠", "箭雨")).toBe("volley");
    expect(ultimateShape("关羽", "绝技")).toBe("crescent");
    expect(ultimateShape("赵云", "绝技")).toBe("thrust");
    expect(ultimateShape("马超", "绝技")).toBe("charge");
  });
  it("maps actual named skills before the generic weapon fallback", () => {
    expect(ultimateShape("赵云", "七进七出")).toBe("phantom");
    expect(ultimateShape("刘备", "圣剑")).toBe("holy-sword");
    expect(ultimateShape("关羽", "跳斩")).toBe("leap");
    expect(ultimateShape("张翼", "跳斩")).toBe("leap");
    expect(ultimateShape("黄忠", "火箭烈")).toBe("fire-rain");
    expect(ultimateShape("马超", "晕眩")).toBe("stun");
    expect(ultimateShape("关平", "大喝")).toBe("shockwave");
  });
});
