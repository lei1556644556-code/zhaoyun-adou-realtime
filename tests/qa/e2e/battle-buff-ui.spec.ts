import { expect, test } from "@playwright/test";
import { createMatch } from "@adou/shared";
import { designPoint, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

function battleBuffSnapshot() {
  const snapshot = createMatch("QA-BUFF", 0xB0FF, 0);
  snapshot.phase = "waiting";
  snapshot.players.forEach((player) => {
    player.phase = "waiting";
    player.prepareMs = 0;
    player.remainingToSpawn = 0;
    player.units = [];
    player.enemies = [];
    if (player.props) player.props.configured = true;
  });
  snapshot.players[0].battleBuffs = [
    { id: "buff-immune", kind: "invulnerable" },
    { id: "buff-haste", kind: "haste" },
    { id: "buff-giant", kind: "giant" },
    { id: "buff-rally", kind: "rally" },
  ];
  snapshot.players[1].enemies = [{
    id: "inspect-boss", hp: 700, maxHp: 700, progress: 0, boss: true, bossType: 0, stunnedMs: 0,
    pathX: 0, pathY: 9, pathIndex: 1, bossCooldownMs: 0, scaleMultiplier: 1,
  }];
  return snapshot;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockAuthenticatedAccount(page, battleBuffSnapshot());
});

test("shows buff details, boss skills, and drags a buff to the opponent monster", async ({ page }, testInfo) => {
  await openRestoredBattle(page);
  const dock = page.locator("#battle-buff-dock");
  await expect(dock).toBeVisible();
  await expect(page.locator("#battle-buff-bar button")).toHaveCount(4);
  const dockBox = await dock.boundingBox();
  const recruitLeft = await designPoint(page, 188, 1222);
  const campBottom = await designPoint(page, 95, 1140);
  expect(dockBox).not.toBeNull();
  expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(recruitLeft.x + 8);
  expect(dockBox!.y).toBeGreaterThanOrEqual(campBottom.y - 1);

  await page.locator('[data-battle-buff-kind="rally"]').click();
  await expect(page.locator("#unit-inspector-name")).toHaveText("振奋");
  await expect(page.locator("#unit-inspector-skill")).toContainText("半径 2 格");
  await page.locator("#unit-inspector-close").click();

  const bossPoint = await designPoint(page, 600, 240);
  await page.mouse.click(bossPoint.x, bossPoint.y);
  await expect(page.locator("#unit-inspector-name")).toHaveText("BOSS · 摄魂");
  await expect(page.locator("#unit-inspector-skill")).toContainText("技能「摄魂」");
  await expect(page.locator("#unit-inspector-skill")).toContainText("混乱");
  await page.locator("#unit-inspector-close").click();

  const immune = page.locator('[data-battle-buff-kind="invulnerable"]');
  await immune.scrollIntoViewIfNeeded();
  const source = await immune.boundingBox();
  expect(source).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(source!.x + source!.width / 2 + 18, source!.y + source!.height / 2, { steps: 3 });
  await page.mouse.move(bossPoint.x, bossPoint.y, { steps: 12 });
  await page.mouse.up();

  await expect(immune).toHaveCount(0);
  await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    const saved = raw ? JSON.parse(raw) : null;
    return saved?.snapshot?.players?.[1]?.enemies?.[0]?.battleInvulnerableMs;
  }, QA_USER_ID)).toBe(5_000);

  await testInfo.attach(`${testInfo.project.name}-battle-buffs`, {
    body: await page.screenshot({ fullPage: true }), contentType: "image/png",
  });
});
