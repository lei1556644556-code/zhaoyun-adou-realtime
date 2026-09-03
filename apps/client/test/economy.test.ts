import { describe, expect, it } from "vitest";
import { normalizeEconomy } from "../src/auth/economy";

describe("account economy day rollover", () => {
  it("resets daily battle data without resetting the permanent account round", () => {
    const economy = normalizeEconomy({
      dayKey: "2026-09-02", gold: 80, stamina: 12, winDay: 2, loseDay: 1,
      totalMatches: 17, ownedProps: [{ id: 5, level: 1 }],
      completedMatchKeys: ["old-a", "old-b"],
    }, "2026-09-03");

    expect(economy).toMatchObject({
      dayKey: "2026-09-03", gold: 80, stamina: 12, winDay: 0, loseDay: 0,
      totalMatches: 17, ownedProps: [], completedMatchKeys: ["old-a", "old-b"],
    });
  });

  it("migrates older saves by using retained completed match ids as the minimum total", () => {
    const economy = normalizeEconomy({
      dayKey: "2026-09-03", completedMatchKeys: ["a", "b", "c"],
    }, "2026-09-03");

    expect(economy.totalMatches).toBe(3);
  });
});
