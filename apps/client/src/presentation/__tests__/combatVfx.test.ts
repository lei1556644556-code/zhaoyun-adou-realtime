import { expect, it, vi } from "vitest";
import type Phaser from "phaser";
import { createMatch, type CombatEffectEvent } from "@adou/shared";
vi.mock("phaser", () => ({ default: { Math: {
  Angle: { Between: (x: number, y: number, tx: number, ty: number) => Math.atan2(ty-y, tx-x) },
  Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx-x, ty-y) },
} } }));
import { CombatVfx } from "../combatVfx";

function harness() {
  const roots: any[] = [], images: string[] = [], tweens: any[] = [], texts: string[] = [];
  function object(x=0,y=0) {
    const handlers = new Map<string, () => void>();
    const state: any = { x, y, width: 256, height: 256, alpha: 1, rotation: 0, destroyed: false };
    let proxy: any;
    proxy = new Proxy(state, { get(target, key) {
      if (key === "destroy") return () => { if (!state.destroyed) { state.destroyed=true; handlers.get("destroy")?.(); } };
      if (key === "once") return (event: string, cb: () => void) => { handlers.set(event,cb); return proxy; };
      if (key === "setPosition") return (px: number,py: number) => { state.x=px;state.y=py;return proxy; };
      return key in target ? target[key] : () => proxy;
    } });
    return proxy;
  }
  const scene = {
    add: {
      container: (x:number,y:number) => { const root=object(x,y); roots.push(root); return root; },
      image: (_x:number,_y:number,key:string) => { images.push(key); return object(); },
      graphics: () => object(), text: (_x:number,_y:number,value:string) => { texts.push(value); return object(); },
    },
    tweens: { add: (config:any) => { tweens.push(config); }, killTweensOf: vi.fn() },
  };
  const fx = new CombatVfx(scene as unknown as Phaser.Scene, object());
  return { fx, roots, images, tweens, texts, flush() { for(let i=0;i<300 && tweens.length;i++) tweens.shift().onComplete?.(); } };
}
const event = (unitKind: string): CombatEffectEvent => ({
  id: "visual-only", type: "attack", tick: 1, slot: 0, unitId: "u", unitKind,
  sourceCell: 58, targetId: "e", targetProgress: .4, targetBoss: false, damage: 5, hitCount: 1, special: false,
} as CombatEffectEvent);
const from = { x: 240, y: 800 }, to = { x: 150, y: 680 };

it("renders named skills with distinct silhouettes rather than weapon fallback", () => {
  for (const [kind, skill, texture] of [["刘备","圣剑","fx-holy"],["赵云","七进七出","hero-zhao-yun"],
    ["张飞","大喝","fx-thunder"],["黄忠","火箭烈","fx-fire"]]) {
    const h=harness(); h.fx.cast(kind!,skill!,from,to,false); expect(h.images).toContain(texture); h.flush();
    expect(h.roots.every(root=>root.destroyed)).toBe(true);
  }
});
it("bounds effect groups and releases them after tweens finish", () => {
  const h=harness();
  for(let i=0;i<100;i++) h.fx.attack(event("骑"),from,to,false);
  expect(h.roots.length).toBeLessThanOrEqual(36);
  h.flush(); expect(h.roots.every(root=>root.destroyed)).toBe(true);
  h.fx.attack(event("刀"),from,to,false); expect(h.roots.at(-1).destroyed).toBe(false);
});
it("keeps reduced-motion local and does not start a projectile flight", () => {
  const h=harness(); h.fx.attack(event("弓"),from,to,true);
  expect(h.images).toEqual([]);
  expect(h.tweens.some(tween=>tween.x===to.x)).toBe(false);
});
it("does not multiply already aggregated damage or invent damage against immunity", () => {
  const h=harness();
  h.fx.attack({...event("赵云"),damage:25,hitCount:5},from,to,true);
  h.fx.attack({...event("刀"),damage:0},from,to,true);
  expect(h.texts).toEqual(["−25 · 5命中", "−0"]);
});
it("tracks phantom positions only from snapshots and removes expired phantoms", () => {
  const h=harness(), snapshot=createMatch("VFX",1);
  snapshot.players[0].zhaoPhantoms=[{ id:"p",unitId:"u",unitKind:"赵云",x:2,y:6,pathIndex:1,direction:1,
    roundTrips:1,pulseMs:100,launchMs:0,damage:2,hitEnemyIds:[] }];
  const before=JSON.stringify(snapshot);
  h.fx.syncPhantoms(snapshot,0,false);
  expect(h.images).toEqual(["hero-zhao-yun"]);
  expect(h.tweens.at(-1)).toMatchObject({x:200,y:720,duration:100});
  expect(JSON.stringify(snapshot)).toBe(before);
  snapshot.players[0].zhaoPhantoms=[]; h.fx.syncPhantoms(snapshot,0,false); h.fx.destroy();
});
