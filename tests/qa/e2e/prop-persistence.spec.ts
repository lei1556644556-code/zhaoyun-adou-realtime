import { expect, test } from "@playwright/test";
import { acceptanceSnapshot, mockAuthenticatedAccount, QA_USER_ID } from "./fixtures";

function shanghaiDayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

test("keeps a newly acquired prop across an interrupted save and browser restart", async ({ page }) => {
  const dayKey = shanghaiDayKey();
  const backend = await mockAuthenticatedAccount(page, acceptanceSnapshot(), {
    failProgressWrites: 2,
    progress: {
      savedAt: 1,
      activeMode: null,
      practiceSnapshot: undefined,
      propLoadout: { active: [], passive: [] },
      economy: {
        dayKey, gold: 100, stamina: 30, winDay: 0, loseDay: 0, totalMatches: 1,
        ownedProps: [], completedMatchKeys: ["persistence-match"],
        pendingShop: {
          matchKey: "persistence-match",
          offers: [{ id: 5, freeByAd: true }], lotteryIds: [], lotteryUsed: false,
        },
      },
    },
  });

  await page.goto("./");
  const offer = page.locator("[data-buy-offer='0']");
  await expect(offer).toBeVisible();
  await offer.click();
  await expect(page.locator("#active-prop-picker [data-prop-id='5']")).toHaveCount(1);
  await expect.poll(() => page.evaluate((userId) => {
    const raw = localStorage.getItem(`adou-daily-props-v1:${userId}`);
    return raw ? JSON.parse(raw).ownedProps : [];
  }, QA_USER_ID)).toContainEqual({ id: 5, level: 1 });

  await page.reload();
  await expect(page.locator("#active-prop-picker [data-prop-id='5']")).toHaveCount(1);
  await expect.poll(() => ({
    writes: backend.progressWriteCount(),
    ownedProps: backend.readStoredProgress().economy?.ownedProps,
  })).toMatchObject({ writes: 3, ownedProps: [{ id: 5, level: 1 }] });

  await page.evaluate((userId) => localStorage.removeItem(`adou-daily-props-v1:${userId}`), QA_USER_ID);
  await page.reload();
  await expect(page.locator("#active-prop-picker [data-prop-id='5']")).toHaveCount(1);
});
