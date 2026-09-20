import { expect, it } from "vitest";
import { boardTokenHitContains } from "./battleInteraction";

it("assigns overlapping circular targets to the cell under the pointer", () => {
  const left = { x: 200, y: 800, radius: 42 }, right = { x: 280, y: 800, radius: 42 };
  expect(boardTokenHitContains(left, 239, 800)).toBe(true);
  expect(boardTokenHitContains(right, 239, 800)).toBe(false);
  expect(boardTokenHitContains(left, 240, 800)).toBe(false);
  expect(boardTokenHitContains(right, 240, 800)).toBe(true);
});
it("preserves circular corners and disambiguates vertically adjacent cells", () => {
  const top = { x: 200, y: 800, radius: 42 }, bottom = { x: 200, y: 880, radius: 42 };
  expect(boardTokenHitContains(top, 239, 839)).toBe(false);
  expect(boardTokenHitContains(top, 200, 839)).toBe(true);
  expect(boardTokenHitContains(bottom, 200, 839)).toBe(false);
});
