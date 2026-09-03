import { expect, test } from "@playwright/test";
import { designPoint, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockAuthenticatedAccount(page);
});

test("loads a meaningful battle without framework or responsive overflow", async ({ page }, testInfo) => {
  const consoleProblems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleProblems.push(message.text());
  });
  await openRestoredBattle(page);

  await expect(page.locator("body")).toContainText("战局状态");
  await expect(page.locator("vite-error-overlay, #webpack-dev-server-client-overlay")).toHaveCount(0);
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    toolbar: document.querySelector(".battle-toolbar")?.getBoundingClientRect().toJSON(),
    playfield: document.querySelector(".playfield-card")?.getBoundingClientRect().toJSON(),
  }));
  expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.playfield?.left ?? -1).toBeGreaterThanOrEqual(0);
  expect(layout.playfield?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(layout.viewport + 1);
  expect(consoleProblems).toEqual([]);

  await testInfo.attach(`${testInfo.project.name}-battle`, {
    body: await page.screenshot({ fullPage: true }), contentType: "image/png",
  });
});

test("distinguishes click from drag, shows attack range, merges, and restores after reload", async ({ page }, testInfo) => {
  await openRestoredBattle(page);
  const canvas = page.locator("#game canvas");
  const beforeSelection = await canvas.screenshot();

  const boardBlade = await designPoint(page, 200, 800);
  await page.mouse.click(boardBlade.x, boardBlade.y);
  await expect(page.locator("#unit-inspector")).toBeVisible();
  await expect(page.locator("#unit-inspector-name")).toHaveText("刀兵");
  await expect(page.locator("#unit-inspector-level")).toHaveText("Lv.1 / 5");
  await expect(page.locator("#unit-inspector-range")).toHaveText("1.5格");
  const afterSelection = await canvas.screenshot();
  expect(afterSelection.equals(beforeSelection), "canvas should change when authoritative attack cells are highlighted").toBe(false);

  // 手机端属性面板会从底部覆盖营地，真实玩家必须先关闭面板再拖动。
  await page.locator("#unit-inspector-close").click();
  await expect(page.locator("#unit-inspector")).toBeHidden();

  const campBlade = await designPoint(page, 140, 1095);
  await page.mouse.move(campBlade.x, campBlade.y);
  await page.mouse.down();
  await page.mouse.move(campBlade.x + 24, campBlade.y, { steps: 3 });
  await page.mouse.move(boardBlade.x, boardBlade.y, { steps: 12 });
  await page.mouse.up();

  await page.mouse.click(boardBlade.x, boardBlade.y);
  await expect(page.locator("#unit-inspector-level")).toHaveText("Lv.2 / 5");
  await expect(page.locator("#unit-inspector-attack")).toHaveText("4.5");
  await expect(page.locator("#unit-inspector-speed")).toHaveText("0.53秒/次");

  await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    const saved = raw ? JSON.parse(raw) : null;
    return saved?.snapshot?.players?.[0]?.units?.[0]?.level;
  }, QA_USER_ID)).toBe(2);

  await page.reload();
  await expect(page.locator("#mode-label")).toContainText("已恢复");
  await expect(page.locator("#game canvas")).toBeVisible();
  await expect.poll(async () => {
    const restoredBlade = await designPoint(page, 200, 800);
    await page.mouse.click(restoredBlade.x, restoredBlade.y);
    return page.locator("#unit-inspector").evaluate((panel) => (panel as HTMLElement).hidden
      ? "not-interactive"
      : panel.querySelector("#unit-inspector-level")?.textContent);
  }).toBe("Lv.2 / 5");
  await testInfo.attach(`${testInfo.project.name}-merged-restored`, {
    body: await page.screenshot({ fullPage: true }), contentType: "image/png",
  });
});
