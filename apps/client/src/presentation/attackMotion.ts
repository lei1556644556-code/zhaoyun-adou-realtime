import type Phaser from "phaser";
import { combatProfileFor } from "./combatProfiles";

/** Four authored poses, never a looping animation or a combat clock. */
export const ATTACK_STRIPS: Readonly<Record<string, string>> = {
  "刀": "blade", "枪": "spear", "弓": "bow", "骑": "cavalry",
};
export const ATTACK_CONTACT_MS = 55;
export function preloadAttackMotion(scene: Phaser.Scene) {
  for (const name of Object.values(ATTACK_STRIPS)) {
    scene.load.spritesheet(`attack-${name}`, `assets/motion/${name}.webp`, { frameWidth: 512, frameHeight: 512 });
  }
}
export function createAttackMotion(scene: Phaser.Scene) {
  for (const name of Object.values(ATTACK_STRIPS)) {
    const key = `attack-${name}`;
    if (!scene.anims.exists(key)) scene.anims.create({ key, frames: [
      { key, frame: 1, duration: 35 }, { key, frame: 2, duration: 40 },
      { key, frame: 3, duration: 65 }, { key, frame: 0, duration: 20 },
    ], frameRate: 50, repeat: 0 });
  }
}

export function playAttackMotion(body: Phaser.GameObjects.Sprite, kind: string, left: boolean, reduced: boolean) {
  const name = ATTACK_STRIPS[kind];
  if (!name || !body.active) return;
  body.setFlipX(left);
  if (reduced) return; // Essential weapon/impact trace remains in CombatVfx.
  body.play(`attack-${name}`, false);
}

// Backstep, reach, twist, windup width/height. Presentation only, never combat values.
const GLYPH_POSES = {
  cleave: [4, 5, .42, .84, 1.12],
  thrust: [5, 9, .09, 1.12, .86],
  loose: [6, 3, .12, .68, 1.16],
  charge: [4, 8, .22, 1.12, .78],
} as const;

/** Brush-like limbs sit behind the glyph and disappear completely at rest. */
export function addGlyphLimbs(scene: Phaser.Scene, figure: Phaser.GameObjects.Container) {
  const limbs=[[-14,0,-9,8],[14,0,9,8],[-7,12,-6,10],[7,12,6,10]].map(([x,y,dx,dy])=>{
    const limb=scene.add.graphics().setPosition(x!,y!).setAlpha(0);
    limb.lineStyle(3,0xfff8dc,.95).beginPath().moveTo(0,0)
      .lineTo(dx!*.5,dy!*.35).lineTo(dx!,dy!).strokePath();
    limb.once("destroy",()=>scene.tweens.killTweensOf(limb));
    figure.add(limb);return limb;
  });
  figure.setData("limbs",limbs);
}

/** The written character acts; disc, badge, hit area and board position stay fixed. */
export function playTokenAttack(scene: Phaser.Scene, figure: Phaser.GameObjects.Container,
  kind: string, angle: number, reduced: boolean) {
  if (!figure.active) return;
  scene.tweens.killTweensOf(figure);
  figure.setPosition(0,0).setRotation(0).setScale(1);
  const limbs=(figure.getData("limbs") ?? []) as Phaser.GameObjects.Graphics[];
  for(const limb of limbs) {scene.tweens.killTweensOf(limb);limb.setAlpha(0).setRotation(0);}
  if (reduced) return;
  const dx=Math.cos(angle),dy=Math.sin(angle);
  const motion=combatProfileFor(kind).motion;
  const [back,reach,turn,sx,sy]=GLYPH_POSES[motion];
  const sign=dx<-.2 ? -1 : 1;
  const limbPose=(rotations: readonly number[],duration:number,alpha:number)=>limbs.forEach((limb,i)=>{
    scene.tweens.add({targets:limb,rotation:rotations[i],alpha,duration,ease:"Quad.Out"});
  });
  limbPose([sign*.75,-sign*.8,-sign*.3,sign*.25],ATTACK_CONTACT_MS,1);
  scene.tweens.add({targets:figure,x:-dx*back,y:-dy*back-(motion==="cleave" ? 5 : 0),
    rotation:-sign*turn,scaleX:sx,scaleY:sy,
    duration:ATTACK_CONTACT_MS,ease:"Quad.Out",onComplete:()=>{
      if (!figure.active) return;
      limbPose([angle-2.4+.5,angle-.73,sign*.4,-sign*.5],65,1);
      scene.tweens.add({targets:figure,x:dx*reach,y:dy*reach,rotation:sign*turn*.65,scaleX:1.18,scaleY:.9,
        duration:65,ease:"Cubic.Out",onComplete:()=>{
          if (figure.active) {
            limbPose([0,0,0,0],110,0);
            scene.tweens.add({targets:figure,x:0,y:0,rotation:0,scaleX:1,scaleY:1,
              duration:110,ease:"Back.Out"});
          }
        }});
    }});
}
