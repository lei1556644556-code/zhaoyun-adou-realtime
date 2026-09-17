import { expect, test } from "@playwright/test";
import { cellIndex } from "@adou/shared";
import { acceptanceSnapshot, mockAuthenticatedAccount, openRestoredBattle } from "./fixtures";

test("production art is loaded and readable in a populated battle", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/assets/") && response.status() >= 400) errors.push(response.url());
  });
  const snapshot = acceptanceSnapshot();
  snapshot.players.forEach((player) => {
    player.units = [
      { id: `hero-a-${player.slot}`, kind: player.slot ? "关羽" : "赵云", level: 2, cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7), cooldownMs: 0, attackCount: 0 },
      { id: `hero-b-${player.slot}`, kind: player.slot ? "黄忠" : "张飞", level: 2, cell: cellIndex(5, 7), secondaryCell: cellIndex(6, 7), cooldownMs: 0, attackCount: 0 },
      ...(["刀", "弓", "枪", "骑"] as const).map((kind, index) => ({ id: `troop-${player.slot}-${index}`, kind, level: index % 3 + 1, cell: cellIndex(index + 2, 8), cooldownMs: 0, attackCount: 0 })),
    ];
    player.enemies = [{ id: `boss-${player.slot}`, hp: 700, maxHp: 1000, progress: .3, boss: true, bossType: 0, stunnedMs: 0, pathX: 0, pathY: 7, pathIndex: 3 }];
  });
  snapshot.players[0].battleBuffs = [
    { id: "buff-i", kind: "invulnerable" }, { id: "buff-h", kind: "haste" },
    { id: "buff-g", kind: "giant" }, { id: "buff-r", kind: "rally" },
    { id: "buff-s", kind: "smoke" }, { id: "buff-d", kind: "decoy" },
  ];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockAuthenticatedAccount(page, snapshot);
  await openRestoredBattle(page);
  await expect(page.locator("#game canvas")).toHaveClass(/is-battle-ready/);
  await page.screenshot({ path: testInfo.outputPath("production-art.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
