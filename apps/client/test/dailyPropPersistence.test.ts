import { describe, expect, it } from "vitest";
import { mergeOwnedProps, parseDailyPropCache, sameOwnedProps } from "../src/auth/dailyPropPersistence";

describe("daily prop persistence", () => {
  it("recovers same-day props using the highest owned level", () => {
    const merged = mergeOwnedProps(
      [{ id: 5, level: 1 }, { id: 22, level: 1 }],
      [{ id: 8, level: 1 }, { id: 22, level: 3 }],
    );
    expect(merged).toEqual([{ id: 5, level: 1 }, { id: 8, level: 1 }, { id: 22, level: 3 }]);
    expect(sameOwnedProps(merged, [...merged].reverse())).toBe(true);
  });

  it("accepts only a cache from the current Shanghai day", () => {
    const cache = JSON.stringify({
      version: 1, dayKey: "2026-09-04", updatedAt: 123,
      ownedProps: [{ id: 5, level: 1 }], propLoadout: { active: [5], passive: [] },
    });
    expect(parseDailyPropCache(cache, "2026-09-04")?.ownedProps).toEqual([{ id: 5, level: 1 }]);
    expect(parseDailyPropCache(cache, "2026-09-05")).toBeNull();
  });
});
