import { expect, test } from "@playwright/test";
import { cellIndex, GENERAL_SKILLS } from "@adou/shared";
import { acceptanceSnapshot, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test.use({ video: "on" });
for (const kind of ["赵云", "张飞", "关羽", "刘备", "黄忠", "黄祖"] as const) {
  test(`${kind} renders its real skill with complete assets and responsive controls`, async ({ page }, info) => {
    const problems: string[] = [];
    page.on("pageerror", error => problems.push(error.message));
    page.on("response", response => {
      if (response.url().includes("/assets/") && response.status() >= 400) problems.push(response.url());
    });
    const snapshot = acceptanceSnapshot();
    snapshot.phase = "battle";
    snapshot.players.forEach(player => {
      player.phase = "battle"; player.spawnMs = 999_999; player.remainingToSpawn = 1;
    });
    snapshot.players[0].units = [{
      id: "vfx-hero", kind, level: 1, cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7),
      parts: [kind[0]!, kind[1]!], cooldownMs: 1_500, attackCount: GENERAL_SKILLS[kind].attacks,
    }];
    snapshot.players[0].enemies = [{
      id: "vfx-target", hp: 10_000, maxHp: 10_000, progress: .4, boss: false,
      stunnedMs: 0, pathX: 4, pathY: 6, pathIndex: 7,
    }];
    await mockAuthenticatedAccount(page, snapshot);
    await openRestoredBattle(page);
    // Delay the first cast until assets are loaded; capture the real cast rather
    // than an arbitrary page-load frame after its short animation has finished.
    await expect.poll(() => page.evaluate(userId => {
      const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
      return raw ? JSON.parse(raw)?.snapshot?.players[0]?.units[0]?.attackCount : undefined;
    }, QA_USER_ID), { intervals: [50], message: "authoritative skill counter must reset after casting" })
      .toBeLessThan(GENERAL_SKILLS[kind].attacks);
    await page.waitForTimeout(80);
    const canvas = page.locator("#game canvas");
    const first = await canvas.screenshot({ path: info.outputPath("skill-active.png") });
    await page.waitForTimeout(kind === "黄祖" ? 1_100 : 450);
    const next = await canvas.screenshot({ path: info.outputPath("skill-follow-through.png") });
    expect(first.equals(next), "real battle effect must animate").toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(problems).toEqual([]);
    await expect(page.locator("body")).not.toHaveClass(/interaction-dragging/);
  });
}
