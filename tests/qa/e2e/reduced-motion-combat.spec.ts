import { expect, test } from "@playwright/test";
import { cellIndex } from "@adou/shared";
import { acceptanceSnapshot, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test.use({ video: "on" });
for (const kind of ["刀", "枪", "弓", "骑"]) {
  test(`reduced motion retains ${kind} attack and killing feedback in text mode`, async ({ page }, info) => {
    await page.emulateMedia({reducedMotion:"reduce"});
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const snapshot = acceptanceSnapshot(); snapshot.phase = "battle";
    for (const player of snapshot.players) {
      player.phase = "battle"; player.spawnMs = 999_999; player.remainingToSpawn = 1;
    }
    snapshot.players[0].units = [{id:"killer",kind,level:1,cell:cellIndex(2,7),cooldownMs:1_500,attackCount:0}];
    snapshot.players[0].enemies = [{id:"weak-target",hp:.1,maxHp:10,progress:5/17,boss:false,stunnedMs:0}];
    await page.addInitScript(() => localStorage.setItem("adou-piece-display-mode-v1", "text"));
    await mockAuthenticatedAccount(page, snapshot); await openRestoredBattle(page);
    await expect(page.locator("#piece-mode-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(userId => {
      const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
      return raw ? JSON.parse(raw)?.snapshot?.players[0]?.units[0]?.attackCount : 0;
    }, QA_USER_ID), {intervals:[20]}).toBeGreaterThan(0);
    await page.locator("#game canvas").screenshot({path:info.outputPath("reduced-killing-attack.png")});
    await page.waitForTimeout(180);
    await page.locator("#game canvas").screenshot({path:info.outputPath("reduced-hit.png")});
    expect(await page.evaluate(userId => {
      const raw = localStorage.getItem(`adou-practice-save-v1:${userId}`);
      return JSON.parse(raw!)?.snapshot?.players[0]?.enemies.length;
    }, QA_USER_ID)).toBe(0);
    expect(errors).toEqual([]);
  });
}

for (const reduced of [true, false]) {
  test(`Zhao skill has a visible bounded lifecycle in ${reduced ? "reduced" : "normal"} motion`, async ({ page }, info) => {
    await page.emulateMedia({reducedMotion:reduced ? "reduce" : "no-preference"});
    const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    const snapshot=acceptanceSnapshot();snapshot.phase="battle";
    for(const player of snapshot.players) {
      player.phase="battle";player.spawnMs=999_999;player.remainingToSpawn=1;player.units=[];player.enemies=[];
    }
    snapshot.players[0].units=[{id:"zhao-lifecycle",kind:"赵云",level:1,cell:cellIndex(2,7),secondaryCell:cellIndex(3,7),
      cooldownMs:1500,attackCount:29}];
    snapshot.players[0].enemies=[{id:"front",hp:1e8,maxHp:1e8,progress:3/17,boss:false,stunnedMs:1e8}];
    await page.addInitScript(()=>localStorage.setItem("adou-piece-display-mode-v1","text"));
    await mockAuthenticatedAccount(page,snapshot);await openRestoredBattle(page);
    const phantomCount=()=>page.evaluate(userId=>JSON.parse(localStorage.getItem(`adou-practice-save-v1:${userId}`)!)
      .snapshot.players[0].zhaoPhantoms.length,QA_USER_ID);
    await expect.poll(phantomCount,{intervals:[20]}).toBe(1);
    await page.waitForTimeout(650);
    await page.locator("#game canvas").screenshot({path:info.outputPath("zhao-active.png")});
    await page.waitForTimeout(350);
    await page.locator("#game canvas").screenshot({path:info.outputPath("zhao-moving.png")});
    await expect.poll(phantomCount,{timeout:15_000,intervals:[100]}).toBe(0);
    await page.waitForTimeout(300);
    await page.locator("#game canvas").screenshot({path:info.outputPath("zhao-finished.png")});
    expect(errors).toEqual([]);
  });
}
