import { expect, test } from "@playwright/test";
import { cellIndex } from "@adou/shared";
import { acceptanceSnapshot, designPoint, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("portrait-mode general parts remain draggable with real touch input", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop-chromium", "dedicated touch viewport");
  const snapshot = acceptanceSnapshot();
  snapshot.players[0].units = [
    { id: "touch-general", kind: "赵云", level: 2, cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7), parts: ["赵", "云"], cooldownMs: 0, attackCount: 0 },
    { id: "touch-soldier", kind: "刀", level: 1, cell: cellIndex(4, 7), cooldownMs: 0, attackCount: 0 },
  ];
  await mockAuthenticatedAccount(page, snapshot);
  await openRestoredBattle(page);
  const source = await designPoint(page, 200, 800);
  const target = await designPoint(page, 360, 800);
  await page.touchscreen.tap(source.x, source.y);
  await expect(page.locator("#unit-inspector-name")).toContainText("赵云");
  await page.locator("#unit-inspector-close").tap();
  const input = await page.context().newCDPSession(page);
  await input.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...source, id: 1 }] });
  for (let step = 1; step <= 12; step++) {
    await input.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: source.x + (target.x - source.x) * step / 12, y: target.y, id: 1 }] });
  }
  await input.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    return raw ? JSON.parse(raw).snapshot.players[0].units : [];
  }, QA_USER_ID)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "赵", cell: cellIndex(4, 7) }),
    expect.objectContaining({ kind: "刀", cell: cellIndex(2, 7) }),
  ]));
  await expect(page.locator("body")).not.toHaveClass(/interaction-dragging/);
});
