import { expect, it, vi } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { ATTACK_STRIPS, ATTACK_CONTACT_MS, createAttackMotion, playAttackMotion, playTokenAttack } from "../attackMotion";

it("ships four complete four-pose atlases within a separate 320KB animation budget", () => {
  const root = new URL("../../../public/assets/motion/", import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL("manifest.json",root),"utf8"));
  let bytes=0;
  for(const name of Object.values(ATTACK_STRIPS)) {
    expect(manifest[name]).toMatchObject({width:2048,height:512,frames:4});
    expect(statSync(new URL(`${name}.webp`,root)).size).toBe(manifest[name].bytes);
    bytes+=manifest[name].bytes;
  }
  expect(bytes).toBeLessThan(320_000);
});
it("gives the written character anticipation, strike and exact recovery without moving the disc",()=>{
  const tweens:any[]=[],killTweensOf=vi.fn();
  const scene:any={tweens:{killTweensOf,add:(config:any)=>tweens.push(config)}};
  const figure:any={active:true,getData:()=>[],setPosition:vi.fn().mockReturnThis(),setRotation:vi.fn().mockReturnThis(),setScale:vi.fn().mockReturnThis()};
  playTokenAttack(scene,figure,"刀",0,false);
  expect(tweens[0]).toMatchObject({duration:55,x:-4,y:-5,rotation:-.42,scaleX:.84,scaleY:1.12});
  tweens[0].onComplete();tweens[1].onComplete();
  expect(tweens[2]).toMatchObject({x:0,y:0,rotation:0,scaleX:1,scaleY:1,duration:110});
  playTokenAttack(scene,figure,"赵云",0,true);
  expect(tweens).toHaveLength(3);expect(killTweensOf).toHaveBeenCalledTimes(2);
});
it("uses distinct glyph poses for blade, spear, bow and rider and mirrors the attack direction",()=>{
  const poses:any[]=[];
  const scene:any={tweens:{killTweensOf:vi.fn(),add:(pose:any)=>poses.push(pose)}};
  const figure:any={active:true,getData:()=>[],setPosition:vi.fn().mockReturnThis(),setRotation:vi.fn().mockReturnThis(),setScale:vi.fn().mockReturnThis()};
  for(const kind of ["刀","枪","弓","骑"]) playTokenAttack(scene,figure,kind,0,false);
  expect(new Set(poses.map(p=>JSON.stringify([p.x,p.y,p.rotation,p.scaleX,p.scaleY]))).size).toBe(4);
  playTokenAttack(scene,figure,"枪",Math.PI,false);
  expect(poses[4]).toMatchObject({x:5,rotation:.09});
  poses[4].onComplete();expect(poses[5].x).toBe(-9);
  figure.active=false;poses[5].onComplete();expect(poses).toHaveLength(6);
});
it("articulates arms and legs independently then hides them, including reduced-motion interruption",()=>{
  const limbs=Array.from({length:4},()=>({setAlpha:vi.fn().mockReturnThis(),setRotation:vi.fn().mockReturnThis()}));
  const figure:any={active:true,getData:()=>limbs,setPosition:vi.fn().mockReturnThis(),setRotation:vi.fn().mockReturnThis(),setScale:vi.fn().mockReturnThis()};
  const poses:any[]=[],killTweensOf=vi.fn();
  const scene:any={tweens:{killTweensOf,add:(p:any)=>poses.push(p)}};
  playTokenAttack(scene,figure,"枪",0,false);
  expect(poses.slice(0,4).map(p=>p.rotation)).toEqual([.75,-.8,-.3,.25]);
  poses[4].onComplete();poses[9].onComplete();
  expect(poses.slice(10,14).every(p=>p.alpha===0&&p.rotation===0)).toBe(true);
  playTokenAttack(scene,figure,"枪",0,true);
  expect(poses).toHaveLength(15);expect(killTweensOf).toHaveBeenCalledTimes(10);
  for(const limb of limbs)expect(limb.setAlpha).toHaveBeenLastCalledWith(0);
});
it("uses a non-looping anticipation, contact, follow-through and exact idle sequence", () => {
  const create=vi.fn();createAttackMotion({anims:{exists:()=>false,create}} as any);
  for(const [config] of create.mock.calls) {
    expect(config.repeat).toBe(0);
    expect(config.frames.map((f:any)=>f.frame)).toEqual([1,2,3,0]);
    expect(config.frames[0].duration+1000/config.frameRate).toBe(ATTACK_CONTACT_MS);
  }
});
it("restarts the current pose instead of queueing attacks and does not move the board token", () => {
  const body:any={active:true,setFlipX:vi.fn(),play:vi.fn(),x:50,y:70};
  playAttackMotion(body,"刀",true,false);playAttackMotion(body,"刀",false,false);
  expect(body.play.mock.calls).toEqual([["attack-blade",false],["attack-blade",false]]);
  expect([body.x,body.y]).toEqual([50,70]);
  playAttackMotion(body,"枪",true,true);body.active=false;playAttackMotion(body,"弓",true,false);
  expect(body.play).toHaveBeenCalledTimes(2);
});
