import { expect, test } from "@playwright/test";
import { cellIndex, createMatch } from "@adou/shared";
import { designPoint, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test("uses the release cell for an off-center Lv.2/Lv.3 cavalry swap", async ({ page }) => {
  const snapshot = createMatch("QA-BOARD-SWAP", 0x109);
  snapshot.phase = "waiting";
  snapshot.players.forEach((player) => {
    player.phase = "waiting"; player.prepareMs = 0; player.remainingToSpawn = 0; player.enemies = [];
    if (player.props) player.props.configured = true;
  });
  const sourceCell = cellIndex(2, 7);
  const targetCell = cellIndex(3, 7);
  snapshot.players[0].units = [
    { id: "cavalry-2", kind: "骑", level: 2, cell: sourceCell, cooldownMs: 0, attackCount: 0 },
    { id: "cavalry-3", kind: "骑", level: 3, cell: targetCell, cooldownMs: 0, attackCount: 0 },
  ];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockAuthenticatedAccount(page, snapshot);
  await openRestoredBattle(page);

  // 从来源棋子右缘起拖、在目标棋子左侧松手，复现截图里的斜向短拖。
  const source = await designPoint(page, 239, 800);
  const target = await designPoint(page, 245, 800);
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(source.x + 18, source.y, { steps: 2 });
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    const mine = raw ? JSON.parse(raw)?.snapshot?.players?.[0] : null;
    return mine?.units?.map((unit: { id: string; cell: number }) => [unit.id, unit.cell]);
  }, QA_USER_ID)).toEqual(expect.arrayContaining([
    ["cavalry-2", targetCell],
    ["cavalry-3", sourceCell],
  ]));
});
