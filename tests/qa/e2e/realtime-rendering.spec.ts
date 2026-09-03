import { expect, test } from "@playwright/test";
import { MAP_LAYOUTS, cellIndex } from "@adou/shared";
import { acceptanceSnapshot, designPoint, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test("keeps wave 4 combat smooth and accepts a drag while 10Hz snapshots continue", async ({ page }) => {
  const snapshot = acceptanceSnapshot();
  snapshot.phase = "battle";
  const route = MAP_LAYOUTS[snapshot.mapIndex]!.path;
  snapshot.players.forEach((player) => {
    player.phase = "battle";
    player.wave = 4;
    player.prepareMs = 0;
    player.interwaveMs = 1_000_000;
    player.remainingToSpawn = 0;
    player.units = player.unlockedCells
      .filter((cell) => cell !== cellIndex(2, 7))
      .slice(0, 5)
      .map((cell, index) => ({
        id: `late-wave-unit-${player.slot}-${index}`,
        kind: (["刀", "弓", "枪", "骑"] as const)[index % 4]!,
        level: 3,
        cell,
        cooldownMs: 0,
        attackCount: 0,
      }));
    player.enemies = Array.from({ length: 16 }, (_, index) => {
      const routeIndex = 1 + index % Math.min(6, route.length - 2);
      const point = route[routeIndex]!;
      return {
        id: `moving-${player.slot}-${index}`,
        hp: 1_000_000,
        maxHp: 1_000_000,
        progress: routeIndex / (route.length - 1),
        boss: index === 0,
        stunnedMs: 0,
        pathX: point[0],
        pathY: point[1],
        pathIndex: Math.min(routeIndex + 1, route.length - 1),
      };
    });
  });
  snapshot.players[0].reserve = [{ id: "drag-under-load", kind: "刀", level: 1, slot: 0 }];
  snapshot.players[1].reserve = [];
  await mockAuthenticatedAccount(page, snapshot);
  await openRestoredBattle(page);

  const canvas = page.locator("#game canvas");
  await page.waitForTimeout(350);
  const frameRate = await page.evaluate(() => new Promise<number>((resolve) => {
    let frames = 0;
    const start = performance.now();
    const sample = (now: number) => {
      frames += 1;
      if (now - start >= 2_000) resolve(frames * 1000 / (now - start));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  // Playwright's default headless Chromium uses an off-screen software
  // compositor on Windows. Player-facing headed Chromium must sustain 45fps;
  // headless CI retains a lower regression floor for the same loaded scene.
  const minimumFrameRate = process.env.QA_HEADED_PERF === "1" ? 45 : 12;
  expect(frameRate, "wave 4 combat should remain responsive while attack effects are active").toBeGreaterThanOrEqual(minimumFrameRate);
  await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    const players = raw ? JSON.parse(raw)?.snapshot?.players : [];
    return players?.some((player: { units?: Array<{ attackCount?: number }> }) =>
      player.units?.some((unit) => (unit.attackCount ?? 0) > 0));
  }, QA_USER_ID)).toBe(true);
  let previousFrame = await canvas.screenshot();
  let changedFrames = 0;
  for (let index = 0; index < 5; index += 1) {
    await page.waitForTimeout(25);
    const frame = await canvas.screenshot();
    if (!frame.equals(previousFrame)) changedFrames += 1;
    previousFrame = frame;
  }
  expect(changedFrames, "authoritative 10Hz movement should be interpolated between snapshots").toBeGreaterThanOrEqual(2);

  const source = await designPoint(page, 140, 1095);
  const target = await designPoint(page, 200, 800);
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(source.x + 24, source.y, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 30 });
  await page.waitForTimeout(600);
  await page.mouse.up();

  await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
    const mine = raw ? JSON.parse(raw)?.snapshot?.players?.[0] : null;
    return mine?.units?.some((unit: { id: string }) => unit.id === "drag-under-load");
  }, QA_USER_ID)).toBe(true);
});
