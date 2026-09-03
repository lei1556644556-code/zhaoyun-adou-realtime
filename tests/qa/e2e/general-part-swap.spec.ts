import { expect, test } from "@playwright/test";
import { cellIndex, createMatch } from "@adou/shared";
import { designPoint, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test("pulls one character from a fused general and swaps it directly with a soldier", async ({ page }) => {
  const snapshot = createMatch("QA-GENERAL-PART-SWAP", 0x109);
  snapshot.phase = "waiting";
  snapshot.players.forEach((player) => {
    player.phase = "waiting"; player.prepareMs = 0; player.remainingToSpawn = 0; player.enemies = [];
    if (player.props) player.props.configured = true;
  });
  const zhangCell = cellIndex(2, 7);
  const feiCell = cellIndex(3, 7);
  const soldierCell = cellIndex(4, 7);
  snapshot.players[0].units = [
    {
      id: "general-zhangfei", kind: "张飞", level: 2,
      cell: zhangCell, secondaryCell: feiCell, parts: ["张", "飞"], cooldownMs: 0, attackCount: 0,
    },
    { id: "soldier", kind: "骑", level: 3, cell: soldierCell, cooldownMs: 0, attackCount: 0 },
  ];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockAuthenticatedAccount(page, snapshot);
  await openRestoredBattle(page);

  const generalPart = await designPoint(page, 200, 800);
  const soldier = await designPoint(page, 360, 800);
  await page.mouse.move(generalPart.x, generalPart.y);
  await page.mouse.down();
  await page.mouse.move(generalPart.x + 24, generalPart.y, { steps: 3 });
  await page.mouse.move(soldier.x, soldier.y, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    return raw ? JSON.parse(raw)?.snapshot?.players?.[0]?.units : [];
  }, QA_USER_ID)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "soldier", kind: "骑", level: 3, cell: zhangCell }),
    expect.objectContaining({ kind: "飞", level: 2, cell: feiCell }),
    expect.objectContaining({ kind: "张", level: 2, cell: soldierCell }),
  ]));
});
