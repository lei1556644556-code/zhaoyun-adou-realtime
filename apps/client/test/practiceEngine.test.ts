import { describe, expect, it } from "vitest";
import { HERO_PAIRS, type UnitState } from "@adou/shared";
import { findMerge } from "../src/game/PracticeEngine";

function unit(id: string, kind: string, level = 1): UnitState {
  return { id, kind, level, cell: 0, cooldownMs: 0, attackCount: 0 };
}

describe("practice bot merging", () => {
  it("discovers hero pairs from the shared authoritative mapping", () => {
    const configuredPair = Object.keys(HERO_PAIRS)[0];
    expect(configuredPair).toBeDefined();
    const [first, second] = configuredPair!.split("+");
    const candidates = [unit("first", first!), unit("second", second!)];

    expect(findMerge(candidates)).toEqual(candidates);
  });

  it("still merges matching soldiers only at the same level", () => {
    expect(findMerge([unit("one", "刀", 1), unit("two", "刀", 2)])).toBeNull();
    const candidates = [unit("one", "刀", 2), unit("two", "刀", 2)];
    expect(findMerge(candidates)).toEqual(candidates);
  });
});
