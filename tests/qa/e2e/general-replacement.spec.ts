import { expect, test } from "@playwright/test";
import { cellIndex, createMatch } from "@adou/shared";
import { designPoint, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test("replaces 苞 with camp 飞, returns 苞 to the same camp slot, and never asks for an adjacent vacancy", async ({ page }) => {
  const snapshot = createMatch("QA-REPLACE-GENERAL", 0x109);
  snapshot.phase = "waiting";
  snapshot.players.forEach((player) => {
    player.phase = "waiting"; player.prepareMs = 0; player.remainingToSpawn = 0; player.enemies = [];
    if (player.props) player.props.configured = true;
  });
  snapshot.players[0].units = [{
    id: "general-zhangbao", kind: "张苞", level: 2,
    cell: cellIndex(2, 7), secondaryCell: cellIndex(3, 7), parts: ["张", "苞"], cooldownMs: 0, attackCount: 0,
  }];
  snapshot.players[0].reserve = [
    { id: "reserve-fei", kind: "飞", level: 2, slot: 0 },
    { id: "full-1", kind: "刀", level: 1, slot: 1 },
    { id: "full-2", kind: "弓", level: 1, slot: 2 },
    { id: "full-3", kind: "枪", level: 1, slot: 3 },
    { id: "full-4", kind: "骑", level: 1, slot: 4 },
  ];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockAuthenticatedAccount(page, snapshot);
  await openRestoredBattle(page);

  const campFly = await designPoint(page, 140, 1095);
  const baoCell = await designPoint(page, 280, 800);
  await page.mouse.move(campFly.x, campFly.y);
  await page.mouse.down();
  await page.mouse.move(campFly.x + 24, campFly.y, { steps: 3 });
  await page.mouse.move(baoCell.x, baoCell.y, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    const saved = raw ? JSON.parse(raw) : null;
    const mine = saved?.snapshot?.players?.[0];
    return {
      general: mine?.units?.find((unit: { id: string }) => unit.id === "general-zhangbao"),
      camp: mine?.reserve?.find((item: { id: string }) => item.id === "reserve-fei"),
      event: mine?.lastEvent,
    };
  }, QA_USER_ID)).toMatchObject({
    general: { kind: "张飞", level: 2, parts: ["张", "飞"] },
    camp: { kind: "苞", level: 2, slot: 0 },
    event: "换字成将「张飞」Lv.2",
  });
});
