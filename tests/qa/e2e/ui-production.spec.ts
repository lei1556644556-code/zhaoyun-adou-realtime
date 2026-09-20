import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PROPS } from "@adou/shared";
import { acceptanceSnapshot, mockAuthenticatedAccount, openRestoredBattle } from "./fixtures";

function economy(extra: Record<string, unknown> = {}) {
  return { dayKey: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), gold: 240, stamina: 30, winDay: 2, loseDay: 1, totalMatches: 4, ownedProps: [], completedMatchKeys: [], ...extra };
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(async () => {
    await Promise.all([...document.images].filter(image => image.checkVisibility()).map(image => {
      image.loading = "eager";
      return image.decode();
    }));
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

test("login and registration retain readable form and keyboard focus", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await expect(page.locator("#auth-screen")).toBeVisible();
  await capture(page, info, "login");
  await page.locator("#auth-register-tab").click();
  await expect(page.locator("#auth-confirm")).toBeVisible();
  await page.locator("#auth-username").fill("测试将军");
  await page.locator("#auth-username").press("Tab");
  await expect(page.locator("#auth-password")).toBeFocused();
  await capture(page, info, "register");
});

test("lobby art, complete armory and first play button work together", async ({ page }, info) => {
  const problems: string[] = [];
  page.on("pageerror", error => problems.push(error.message));
  page.on("response", response => { if(response.url().includes("/assets/") && response.status() >= 400) problems.push(response.url()); });
  await mockAuthenticatedAccount(page, acceptanceSnapshot(), { progress: { activeMode: null, practiceSnapshot: undefined, economy: economy({ ownedProps: PROPS.map(prop => ({id:prop.id,level:1})) }) } });
  await page.goto("./");
  await expect(page.locator("#lobby")).toBeVisible();
  expect(await page.locator(".account-economy strong").evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
  await capture(page, info, "lobby");
  await page.locator("#prop-armory summary").click();
  await page.locator('[data-prop-id="2"]').click();
  await expect(page.locator('[data-prop-id="2"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#prop-loadout-count")).toContainText("主动 1/2");
  await capture(page, info, "armory");
  await page.locator("#prop-armory summary").click();
  await page.locator("#practice").click();
  await expect(page.locator("#game canvas")).toHaveClass(/is-battle-ready/);
  await expect(page.locator('#active-prop-bar [data-use-prop="2"] img')).toBeVisible();
  await capture(page, info, "first-battle");
  expect(problems).toEqual([]);
});

test("result, shop and reward icons preserve claim and exit flow", async ({ page }, info) => {
  await mockAuthenticatedAccount(page, acceptanceSnapshot(), { progress: { activeMode: null, economy: economy({ pendingResult: { matchKey: "ui-result", won: true, baseReward: 20 } }) } });
  await page.goto("./");
  await expect(page.locator("#postgame-overlay")).toBeVisible();
  await page.locator("#postgame-title").press("Tab");
  await expect(page.locator("#claim-normal")).toBeFocused();
  await page.locator("#claim-normal").press("Shift+Tab");
  await expect(page.locator("#claim-double")).toBeFocused();
  await capture(page, info, "victory");
  await page.locator("#claim-normal").click();
  await expect(page.locator("#shop-pane")).toBeVisible();
  await expect(page.locator("#shop-offers img")).toHaveCount(3);
  await expect(page.locator("#lottery-slots img")).toHaveCount(8);
  await capture(page, info, "shop");
  await page.locator("#lottery-draw").scrollIntoViewIfNeeded();
  await capture(page, info, "lottery");
  await page.locator("#lottery-draw").click();
  await expect(page.locator("#lottery-draw")).toBeDisabled();
  await page.locator("#shop-close").click();
  await expect(page.locator("#lobby")).toBeVisible();
  await expect(page.locator("#postgame-overlay")).toBeHidden();
});

test("ready overlay visual fixture stays inside the playfield", async ({ page }, info) => {
  await mockAuthenticatedAccount(page);
  await openRestoredBattle(page);
  // Presentation fixture only: does not create a real room or test matchmaking.
  await page.addStyleTag({ content: "#match-ready-panel { display: grid !important; }" });
  await page.evaluate(() => {
    document.getElementById("match-ready-panel")!.hidden = false;
    document.getElementById("ready-room-id")!.textContent = "UI2026";
    document.querySelector("#ready-player-0 strong")!.textContent = "测试将军";
    document.querySelector("#ready-player-0 i")!.textContent = "已准备";
    document.getElementById("ready-player-0")!.classList.add("is-ready");
  });
  await capture(page, info, "room-ready");
  const card = await page.locator(".match-ready-card").boundingBox();
  const field = await page.locator(".playfield-card").boundingBox();
  expect(card!.x).toBeGreaterThanOrEqual(field!.x);
  expect(card!.x + card!.width).toBeLessThanOrEqual(field!.x + field!.width + 1);
});
