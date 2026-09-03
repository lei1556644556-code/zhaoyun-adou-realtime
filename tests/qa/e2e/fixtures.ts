import { expect, type Page } from "@playwright/test";
import { createMatch, cellIndex, type MatchSnapshot } from "@adou/shared";

const SUPABASE_ORIGIN = "https://dkaabuxszrbnnrajnoaa.supabase.co";
const AUTH_STORAGE_KEY = "sb-dkaabuxszrbnnrajnoaa-auth-token";
export const QA_USER_ID = "qa-user";

export function acceptanceSnapshot(): MatchSnapshot {
  const snapshot = createMatch("QA-RESTORE", 0x109, 0);
  snapshot.phase = "waiting";
  snapshot.players.forEach((player) => {
    player.phase = "waiting";
    player.prepareMs = 0;
    player.remainingToSpawn = 0;
    player.enemies = [];
    if (player.props) player.props.configured = true;
  });
  snapshot.players[0].units = [{
    id: "board-blade", kind: "刀", level: 1, cell: cellIndex(2, 7), cooldownMs: 0, attackCount: 0,
  }];
  snapshot.players[0].reserve = [{ id: "reserve-blade", kind: "刀", level: 1, slot: 0 }];
  snapshot.players[1].buns = 0;
  snapshot.players[1].reserve = [];
  snapshot.players[1].units = [];
  return snapshot;
}

export async function mockAuthenticatedAccount(page: Page, snapshot = acceptanceSnapshot()) {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const user = {
    id: QA_USER_ID, aud: "authenticated", role: "authenticated", email: "qa@example.invalid",
    email_confirmed_at: createdAt, created_at: createdAt,
    user_metadata: { username: "验收玩家" }, app_metadata: {},
  };
  const session = {
    access_token: "qa-access-token", refresh_token: "qa-refresh-token", token_type: "bearer",
    expires_in: 31_536_000, expires_at: 4_102_444_800, user,
  };
  let progressRevision = 0;
  let storedProgress = { version: 1 as const, savedAt: 1, activeMode: "practice" as const, practiceSnapshot: snapshot };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: AUTH_STORAGE_KEY, value: session,
  });
  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/rest/v1/zhaoyun_adou_profiles") && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify({
          user_id: QA_USER_ID, display_name: "验收玩家", username_normalized: "验收玩家",
          progress: storedProgress, progress_revision: progressRevision,
          created_at: createdAt, updated_at: createdAt,
        }),
      });
      return;
    }
    if (url.pathname === "/rest/v1/rpc/zhaoyun_adou_save_progress" && request.method() === "POST") {
      const payload = request.postDataJSON() as { p_expected_revision: number; p_progress: typeof storedProgress };
      if (payload.p_expected_revision !== progressRevision) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ code: "40001", message: "progress revision conflict" }),
        });
        return;
      }
      storedProgress = payload.p_progress;
      progressRevision += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          saved_progress: storedProgress,
          saved_revision: progressRevision,
          saved_at: new Date().toISOString(),
        }),
      });
      return;
    }
    if (url.pathname === "/auth/v1/user") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

export async function openRestoredBattle(page: Page) {
  // A relative URL preserves the GitHub Pages project prefix when QA_BASE_URL
  // points at a deployed build, while still resolving to / for local Vite.
  await page.goto("./");
  await expect(page).toHaveTitle(/赵云与阿斗/);
  await expect(page.locator("#battle-shell")).toBeVisible();
  await expect(page.locator("#mode-label")).toContainText("已恢复");
  await expect(page.locator("#game canvas")).toBeVisible();
}

export async function designPoint(page: Page, x: number, y: number) {
  const box = await page.locator("#game canvas").boundingBox();
  if (!box) throw new Error("Game canvas has no bounding box");
  return { x: box.x + x / 640 * box.width, y: box.y + y / 1386 * box.height };
}
