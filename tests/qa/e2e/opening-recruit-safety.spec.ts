import { expect, test } from "@playwright/test";
import { SOLDIERS, createMatch } from "@adou/shared";
import { designPoint, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test("keeps the first recruit playable when the original draw would be only names and a shovel", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const opening = createMatch("OPENING-SAFETY", 16);
  opening.phase = "waiting";
  opening.players.forEach((player) => {
    player.phase = "waiting";
    player.prepareMs = 0;
    player.remainingToSpawn = 0;
    player.props!.configured = true;
  });
  opening.players[1].buns = 0;
  await mockAuthenticatedAccount(page, opening);
  await openRestoredBattle(page);

  const recruit = await designPoint(page, 320, 1222);
  await page.mouse.click(recruit.x, recruit.y);

  const kinds = await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    const saved = raw ? JSON.parse(raw) : null;
    return saved?.snapshot?.players?.[0]?.reserve?.map((item: { kind: string }) => item.kind) ?? [];
  }, QA_USER_ID)).toHaveLength(5).then(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    return raw ? JSON.parse(raw).snapshot.players[0].reserve.map((item: { kind: string }) => item.kind) : [];
  }, QA_USER_ID));

  expect(kinds.slice(0, 4)).toEqual(["赵", "张", "刘", "飞"]);
  expect(kinds.some((kind: string) => kind in SOLDIERS)).toBe(true);
  await testInfo.attach(`${testInfo.project.name}-opening-safety`, {
    body: await page.screenshot({ fullPage: true }), contentType: "image/png",
  });
});
