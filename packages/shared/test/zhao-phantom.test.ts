import { expect, it } from "vitest";
import { cellIndex, createMatch, MAP_LAYOUTS, normalizeMatchSnapshot, stepMatch, type MatchSnapshot } from "../src/index";

function pathFor(mapIndex = 0) {
  const path: Array<{x:number;y:number}> = [];
  for (const [x,y] of MAP_LAYOUTS[mapIndex]!.path) {
    if (!path.length) { path.push({x,y}); continue; }
    let last = path.at(-1)!;
    while (last.x !== x || last.y !== y) {
      last = {x:last.x+Math.sign(x-last.x),y:last.y+Math.sign(y-last.y)}; path.push(last);
    }
  }
  return path;
}
function fixture(node = 5, mapIndex = 0) {
  const snapshot = createMatch("ZHAO", 18, mapIndex);
  snapshot.phase = "battle";
  for (const player of snapshot.players) {
    player.phase = "battle"; player.spawnMs = 999_999; player.remainingToSpawn = 1;
    player.units = []; player.enemies = [];
  }
  const path = pathFor(mapIndex), point = path[node]!;
  snapshot.players[0].enemies = [{id:"target",hp:1e8,maxHp:1e8,boss:false,stunnedMs:1e8,
    pathIndex:node,pathX:point.x,pathY:point.y,progress:node/(path.length-1)}];
  snapshot.players[0].zhaoPhantoms = [{id:"p",unitId:"zhao",unitKind:"赵云",...point,pathIndex:node,
    direction:-1,turnPathIndex:0,moveAccumulatorMs:0,roundTrips:0,launchMs:0,pulseMs:100,damage:2,hitEnemyIds:[]}];
  return snapshot;
}
function untilGone(snapshot: MatchSnapshot) {
  let elapsed = 0, highestRound = 0;
  while (snapshot.players[0].zhaoPhantoms!.length && elapsed < 120_000) {
    highestRound = Math.max(highestRound,snapshot.players[0].zhaoPhantoms![0]!.roundTrips);
    stepMatch(snapshot,100); elapsed+=100;
  }
  expect(snapshot.players[0].zhaoPhantoms).toEqual([]);
  expect(highestRound).toBe(6);
  return elapsed;
}

it("returns to the enemy front, not the end of the map, and expires after seven trips", () => {
  const snapshot=fixture(3);
  // Original 60Hz method audit: a fixed target at node 3 finishes in 11.567s.
  expect(untilGone(snapshot)).toBe(11_600);
});
it("reacquires the enemy-front node on each turn", () => {
  const snapshot=fixture(5), phantom=snapshot.players[0].zhaoPhantoms![0]!;
  let ticks=0;
  while (phantom.direction<0 && ticks++<100) stepMatch(snapshot,100);
  expect(phantom.turnPathIndex).toBe(5);
  const enemy=snapshot.players[0].enemies[0]!, point=pathFor()[2]!;
  Object.assign(enemy,{pathX:point.x,pathY:point.y,pathIndex:2,progress:2/17});
  while (phantom.roundTrips<1 && ticks++<150) stepMatch(snapshot,100);
  while (phantom.direction<0 && ticks++<200) stepMatch(snapshot,100);
  expect(phantom.turnPathIndex).toBe(2);
  expect(phantom.roundTrips).toBe(1);
});
it("does not loop forever when the last enemy disappears", () => {
  const snapshot=fixture(); snapshot.players[0].enemies=[];
  expect(untilGone(snapshot)).toBeLessThan(20_000);
});
it("keeps the full 500ms launch before moving", () => {
  const snapshot=fixture(), phantom=snapshot.players[0].zhaoPhantoms![0]!;
  const position={x:phantom.x,y:phantom.y}; phantom.launchMs=500;
  for(let i=0;i<5;i++) stepMatch(snapshot,100);
  expect(phantom).toMatchObject({...position,launchMs:0});
  stepMatch(snapshot,100); expect({x:phantom.x,y:phantom.y}).not.toEqual(position);
});
it("allows repeated thirty-attack casts without replacing an existing phantom", () => {
  const snapshot=fixture(7), player=snapshot.players[0];
  player.units=[{id:"zhao",kind:"赵云",level:1,cell:cellIndex(2,7),secondaryCell:cellIndex(3,7),cooldownMs:0,attackCount:29}];
  stepMatch(snapshot,100);
  expect(player.units[0]!.attackCount).toBe(0);
  expect(player.zhaoPhantoms).toHaveLength(2);
  for(let i=0;i<29;i++) { player.units[0]!.cooldownMs=0;stepMatch(snapshot,100); }
  expect(player.zhaoPhantoms).toHaveLength(2);
  player.units[0]!.cooldownMs=0;stepMatch(snapshot,100);
  expect(player.zhaoPhantoms).toHaveLength(3);
  expect(player.zhaoPhantoms![0]!.id).toBe("p");
});
it("retains a charged cast when the threshold attack kills the final target", () => {
  const snapshot=fixture(), player=snapshot.players[0]; player.zhaoPhantoms=[];
  player.units=[{id:"zhao",kind:"赵云",level:1,cell:cellIndex(2,7),secondaryCell:cellIndex(3,7),cooldownMs:0,attackCount:29}];
  player.enemies[0]!.hp=.1;stepMatch(snapshot,100);
  expect(player.zhaoPhantoms).toEqual([]);expect(player.units[0]!.attackCount).toBe(30);
});
it("migrates an old in-flight save without teleporting or getting stuck beyond the new target", () => {
  const snapshot=fixture(), phantom=snapshot.players[0].zhaoPhantoms![0]!;
  Object.assign(phantom,{...pathFor()[10],pathIndex:10,direction:1,roundTrips:3});
  delete phantom.turnPathIndex;delete phantom.moveAccumulatorMs;
  const position={x:phantom.x,y:phantom.y};normalizeMatchSnapshot(snapshot);
  expect(phantom).toMatchObject({...position,pathIndex:11,turnPathIndex:11,roundTrips:3});
  expect(untilGone(snapshot)).toBeLessThan(60_000);
});
it.each([0,1,2])("deterministically resumes phantom movement on map %i", mapIndex => {
  const snapshot=fixture(5,mapIndex);
  for(let i=0;i<37;i++) stepMatch(snapshot,100);
  const resumed=normalizeMatchSnapshot(JSON.parse(JSON.stringify(snapshot)));
  for(let i=0;i<300;i++) { stepMatch(snapshot,100);stepMatch(resumed,100); }
  expect(resumed).toEqual(snapshot);expect(snapshot.players[0].zhaoPhantoms).toEqual([]);
});
