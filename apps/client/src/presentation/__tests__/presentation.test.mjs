import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "vitest";
import {
  ASSET_MANIFEST,
  ASSET_TOTAL_RASTER_BYTES,
  BattlePresentationController,
  combatProfileFor,
  projectBattleEvent,
  rasterAssetsFor,
  resolvePieceVisual,
} from "../index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(here, "../../../public");
const context = { surface: "mobile", motion: "full", audioEnabled: true };

test("manifest has unique stable keys and all declared raster files exist", () => {
  const assets = Object.values(ASSET_MANIFEST.assets);
  assert.equal(new Set(assets.map((asset) => asset.key)).size, assets.length);
  const rasters = assets.filter((asset) => asset.source.kind === "raster");
  assert.equal(rasters.length, 36);
  for (const asset of rasters) assert.ok(existsSync(resolve(publicRoot, asset.source.path)), asset.source.path);
  assert.equal(ASSET_TOTAL_RASTER_BYTES, 1_843_376);
});

test("text mode skips portrait assets and remains a first-class fallback", () => {
  assert.ok(rasterAssetsFor("battle", "text").every((asset) => !asset.iconModeOnly));
  const piece = resolvePieceVisual({ kind: "赵云", level: 4, rarity: "gold", mode: "text", surface: "mobile" });
  assert.equal(piece.mode, "text");
  assert.equal(piece.iconAssetKey, undefined);
  assert.equal(piece.levelLabel, "Lv.4");
  assert.equal(piece.rarityMark, "神");
});

test("icon mode resolves a large portrait and falls back to text for unknown pieces", () => {
  const hero = resolvePieceVisual({ kind: "赵云", level: 3, rarity: "gold", mode: "icon", surface: "desktop" });
  assert.equal(hero.mode, "icon");
  assert.equal(hero.iconAssetKey, "hero-zhao-yun");
  assert.ok(hero.iconSize >= 72);
  const unknown = resolvePieceVisual({ kind: "农", level: 1, rarity: "common", mode: "icon", surface: "mobile" });
  assert.equal(unknown.mode, "text");
});

test("every playable identity has a distinct profile without portrait scaling cues", () => {
  const identities = ["刀", "弓", "枪", "骑", "赵云", "张飞", "马超", "关羽", "黄忠", "关平", "关兴", "张苞", "张翼", "黄盖", "刘备", "黄祖"];
  assert.equal(new Set(identities.map((kind) => combatProfileFor(kind).id)).size, identities.length);
  const attack = {
    id: "event-attack-1", roomId: "room", tick: 1, slot: 0, type: "ATTACK_RESOLVED", special: false,
    actor: { id: "hero-1", kind: "赵云", role: "hero" }, from: { kind: "cell", cell: 4 },
    impacts: [{ target: { id: "enemy-1", kind: "rebel", role: "enemy" }, at: { kind: "path", progress: 0.4 }, amountText: "−12" }],
  };
  const cues = projectBattleEvent(attack, context);
  assert.deepEqual(cues.slice(0, 3).map((cue) => cue.kind), ["actor-motion", "projectile", "impact"]);
  assert.ok(cues.every((cue) => !Object.hasOwn(cue, "scalePortrait")));
});

test("merge, upgrade and death each emit explicit semantic feedback", () => {
  const base = { roomId: "room", tick: 2, slot: 0 };
  const entity = { id: "zhao", kind: "赵云", role: "hero" };
  const merge = projectBattleEvent({
    ...base, id: "merge-1", type: "UNIT_MERGED", sources: [entity, { ...entity, id: "zhao-2" }],
    result: { ...entity, level: 2, rarity: "gold" }, at: { kind: "cell", cell: 8 },
  }, context);
  assert.deepEqual(merge.filter((cue) => cue.kind !== "audio").map((cue) => cue.kind), ["merge", "upgrade"]);
  const upgrade = projectBattleEvent({
    ...base, id: "upgrade-1", type: "UNIT_UPGRADED", entity: { ...entity, rarity: "gold" },
    fromLevel: 2, toLevel: 3, at: { kind: "cell", cell: 8 },
  }, context);
  assert.equal(upgrade[0].kind, "upgrade");
  const death = projectBattleEvent({
    ...base, id: "death-1", type: "ENTITY_DIED", entity: { id: "boss", kind: "boss-banner", role: "boss" },
    at: { kind: "path", progress: 0.9 },
  }, context);
  assert.equal(death[0].kind, "death");
  assert.equal(death[0].treatment, "banner-fall");
});

test("controller deduplicates event ids and respects the reduced-motion batch budget", () => {
  const batches = [];
  const controller = new BattlePresentationController({ enqueue: (cues) => batches.push(cues) });
  const attacks = Array.from({ length: 20 }, (_, index) => ({
    id: `attack-${index}`, roomId: "room", tick: index, slot: 0, type: "ATTACK_RESOLVED", special: false,
    actor: { id: "archer", kind: "弓", role: "troop" }, from: { kind: "cell", cell: 1 },
    impacts: [{ target: { id: `enemy-${index}`, kind: "rebel", role: "enemy" }, at: { kind: "path", progress: 0.2 }, amountText: "−2" }],
  }));
  const stats = controller.consume(attacks, { surface: "mobile", motion: "reduced", audioEnabled: false });
  assert.equal(stats.emittedCues, 18);
  assert.ok(stats.droppedCues > 0);
  assert.equal(controller.consume(attacks, context).duplicateEvents, attacks.length);
  assert.equal(batches.length, 1);
});

test("controller also deduplicates repeated ids inside one delivery", () => {
  const batches = [];
  const controller = new BattlePresentationController({ enqueue: (cues) => batches.push(cues) });
  const event = {
    id: "death-same-batch", roomId: "room", tick: 9, slot: 0, type: "ENTITY_DIED",
    entity: { id: "enemy", kind: "rebel", role: "enemy" }, at: { kind: "path", progress: 0.5 },
  };
  const stats = controller.consume([event, event], context);
  assert.equal(stats.duplicateEvents, 1);
  assert.equal(batches[0].filter((cue) => cue.kind === "death").length, 1);
});
