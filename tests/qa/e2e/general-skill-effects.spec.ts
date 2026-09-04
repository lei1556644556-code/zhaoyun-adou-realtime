import { expect, test } from "@playwright/test";
import { cellIndex } from "@adou/shared";
import { acceptanceSnapshot, mockAuthenticatedAccount, openRestoredBattle } from "./fixtures";

test("renders the authoritative original-skill event without breaking desktop or mobile battle layout", async ({ page }, testInfo) => {
  const snapshot = acceptanceSnapshot();
  snapshot.phase = "battle";
  snapshot.players.forEach((player) => {
    player.phase = "battle"; player.spawnMs = 999_999; player.remainingToSpawn = 1;
  });
  snapshot.players[0].units = [{
    id: "zhangfei", kind: "张飞", level: 1, cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7),
    parts: ["张", "飞"], cooldownMs: 0, attackCount: 15,
  }];
  snapshot.players[0].enemies = [{
    id: "skill-target", hp: 1_000, maxHp: 1_000, progress: 0.4, boss: false, stunnedMs: 0,
    pathX: 4, pathY: 6, pathIndex: 7,
  }];
  await mockAuthenticatedAccount(page, snapshot);
  await openRestoredBattle(page);
  await page.waitForTimeout(120);

  const canvas = page.locator("#game canvas");
  const activeFrame = await canvas.screenshot();
  await page.screenshot({ path: testInfo.outputPath(`general-skill-${testInfo.project.name}.png`), fullPage: true });
  await page.waitForTimeout(1_000);
  const settledFrame = await canvas.screenshot();

  expect(activeFrame.byteLength).toBeGreaterThan(10_000);
  expect(activeFrame.equals(settledFrame), "skill banner and burst should be transient").toBe(false);
  await expect(page.locator("body")).not.toHaveClass(/interaction-dragging/);
});
