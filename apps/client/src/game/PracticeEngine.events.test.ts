import { afterEach, expect, it, vi } from "vitest";
import { cellIndex, createMatch, GENERAL_SKILLS, stepMatch, type MatchSnapshot } from "@adou/shared";
import { PracticeEngine } from "./PracticeEngine";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture() {
  const snapshot = createMatch("PRACTICE-FX", 18, 0);
  snapshot.phase = "battle";
  for (const player of snapshot.players) {
    player.phase = "battle"; player.prepareMs = 0; player.spawnMs = 999_999; player.remainingToSpawn = 1;
    player.units = []; player.enemies = []; player.reserve = [];
  }
  snapshot.players[0].units = [{id:"attacker",kind:"刀",level:1,cell:cellIndex(2,7),cooldownMs:550,attackCount:0}];
  snapshot.players[0].enemies = [{id:"target",hp:.1,maxHp:10,progress:5/17,boss:false,stunnedMs:0}];
  return snapshot;
}

it("publishes a killing attack even when the bot places a piece on the same tick", () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {setInterval,clearInterval});
  const snapshot = fixture();
  snapshot.players[1].reserve = [{id:"bot-piece",kind:"刀",level:1,slot:0}];
  const engine = new PracticeEngine(snapshot);
  let published: MatchSnapshot = snapshot;
  engine.addEventListener("snapshot", event => { published = (event as CustomEvent<MatchSnapshot>).detail; });
  engine.start(); vi.advanceTimersByTime(600); engine.stop();
  expect(published.players[0].enemies).toEqual([]);
  expect(published.players[1].reserve).toEqual([]);
  expect(published.events.some(event => event.type === "attack" && event.unitId === "attacker")).toBe(true);
  expect(published.combatEvents).toEqual(published.events.filter(event => event.type === "attack"));
});

it("Zhao phantom completes its seven round trips without visual timers controlling its life", () => {
  const snapshot = fixture();
  snapshot.players[0].units = [{id:"zhao",kind:"赵云",level:1,cell:cellIndex(2,7),secondaryCell:cellIndex(3,7),
    cooldownMs:0,attackCount:GENERAL_SKILLS.赵云.attacks}];
  snapshot.players[0].enemies[0]!.hp = 1_000;
  snapshot.players[0].enemies[0]!.maxHp = 1_000;
  stepMatch(snapshot,100);
  expect(snapshot.players[0].zhaoPhantoms).toHaveLength(1);
  snapshot.players[0].units = [];
  let elapsed = 0, maxRoundTrips = 0;
  while (snapshot.players[0].zhaoPhantoms!.length && elapsed < 180_000) {
    maxRoundTrips = Math.max(maxRoundTrips, snapshot.players[0].zhaoPhantoms![0]!.roundTrips);
    stepMatch(snapshot,100); elapsed += 100;
  }
  expect(maxRoundTrips).toBe(GENERAL_SKILLS.赵云.roundTrips - 1);
  expect(snapshot.players[0].zhaoPhantoms).toEqual([]);
  expect(elapsed).toBeLessThan(180_000);
});
