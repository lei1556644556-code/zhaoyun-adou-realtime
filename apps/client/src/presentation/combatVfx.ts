import Phaser from "phaser";
import { GAME_CONFIG, type CombatEffectEvent, type MatchSnapshot, type PlayerSlot } from "@adou/shared";
import { HERO_ASSET_KEYS, TROOP_ASSET_KEYS } from "../game/assets";
import { battleAttackStyle, ultimateShape } from "./battleArt";

type Point = { x: number; y: number };
type Style = ReturnType<typeof battleAttackStyle>;
export const COMBAT_FX_KEYS = ["fx-jade", "fx-silver", "fx-holy", "fx-fire", "fx-dust", "fx-thunder"] as const;

/** Cosmetics only. No random simulation, damage, targeting, or network writes. */
export class CombatVfx {
  private active = 0;
  private readonly groups = new Set<Phaser.GameObjects.Container>();
  private readonly phantoms = new Map<string, Phaser.GameObjects.Image>();
  constructor(private readonly scene: Phaser.Scene, private readonly layer: Phaser.GameObjects.Container) {}

  private group(point: Point) {
    if (this.active >= 36) return null;
    const root = this.scene.add.container(point.x, point.y);
    this.layer.add(root); this.active++; this.groups.add(root);
    root.once("destroy", () => { this.active--; this.groups.delete(root); });
    return root;
  }
  private paint(key: string, width: number, height = width) {
    const image = this.scene.add.image(0, 0, key);
    return image.setScale(Math.min(width / image.width, height / image.height));
  }
  private blade(style: Style, size: number) {
    if (style.profileId === "hero.guan-yu.crescent-cleave") return this.paint("fx-jade", size);
    const blade = this.scene.add.graphics();
    blade.lineStyle(size * .13, style.color, .3).beginPath().arc(0, 0, size * .32, -1.2, 1.2).strokePath();
    blade.lineStyle(size * .07, style.accent, .95).beginPath().arc(0, 0, size * .36, -1.05, 1.2).strokePath();
    blade.lineStyle(2, 0xfffbed, .95).beginPath().arc(0, 0, size * .39, -.7, 1.2).strokePath();
    return blade;
  }
  private fade(root: Phaser.GameObjects.Container, duration: number, delay = 0) {
    this.scene.tweens.add({ targets: root, alpha: 0, duration, delay, onComplete: () => root.destroy() });
  }
  private sparks(point: Point, style: Style, angle: number, heavy: boolean, reduced: boolean) {
    const root = this.group(point); if (!root) return;
    const g = this.scene.add.graphics().setRotation(angle);
    const count = reduced ? 2 : heavy ? 8 : 4;
    for (let i = 0; i < count; i++) {
      const a = (i / count - .5) * 2.6, length = (heavy ? 36 : 20) + i % 3 * 7;
      g.lineStyle(i % 2 ? 2 : 3, i % 2 ? style.color : style.accent, .95)
        .lineBetween(Math.cos(a) * 5, Math.sin(a) * 5, Math.cos(a) * length, Math.sin(a) * length);
    }
    g.fillStyle(0xffffff, .95).fillTriangle(-8, -2, 11, 0, -8, 2);
    root.add(g).setScale(.5);
    this.scene.tweens.add({ targets: root, scale: reduced ? .85 : 1.4, duration: reduced ? 90 : 210, ease: "Cubic.Out" });
    this.fade(root, reduced ? 220 : 240);
  }
  private dust(point: Point, scale = 1) {
    const root = this.group(point); if (!root) return;
    root.add(this.paint("fx-dust", 112 * scale, 68 * scale)).setAlpha(.6);
    this.scene.tweens.add({ targets: root, scale: 1.35, y: point.y + 12, duration: 370 });
    this.fade(root, 370);
  }
  private stun(point: Point, reduced: boolean) {
    const root = this.group({ x: point.x, y: point.y - 32 }); if (!root) return;
    const stars = this.scene.add.graphics();
    stars.lineStyle(1, 0xffe49b, .55).strokeEllipse(0, 0, 47, 13);
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3, x = Math.cos(angle) * 24, y = Math.sin(angle) * 7;
      stars.fillStyle(0xffe49b).fillTriangle(x - 5, y, x + 5, y, x, y - 9)
        .fillTriangle(x - 5, y - 5, x + 5, y - 5, x, y + 4);
    }
    root.add(stars);
    this.scene.tweens.add({ targets: root, y: point.y - (reduced ? 32 : 41), duration: reduced ? 130 : 400 });
    this.fade(root, reduced ? 130 : 400);
  }
  private slash(point: Point, style: Style, angle: number, size: number, reduced: boolean) {
    const root = this.group(point); if (!root) return;
    root.add(this.blade(style, size));
    root.setRotation(angle - .65).setScale(.65).setAlpha(.85);
    this.scene.tweens.add({ targets: root, rotation: angle + .5, scale: reduced ? .8 : 1.12,
      duration: reduced ? 90 : 230, ease: "Cubic.Out" });
    this.fade(root, reduced ? 100 : 250);
  }
  private arrow(style: Style, fire: boolean) {
    if (fire) return this.paint("fx-fire", 88, 36);
    const g = this.scene.add.graphics();
    g.fillStyle(style.color, .2).fillTriangle(-63, -6, 26, 0, -63, 6);
    g.lineStyle(3, 0xcdbb8b).lineBetween(-25, 0, 23, 0);
    g.fillStyle(style.accent).fillTriangle(29, 0, 15, -5, 15, 5);
    g.lineStyle(2, style.accent).lineBetween(-24, 0, -32, -7).lineBetween(-24, 0, -32, 7);
    return g;
  }
  private chargeTrail(style: Style) {
    const g = this.scene.add.graphics();
    for (let i = -1; i <= 1; i++) {
      const y = i * 13;
      g.lineStyle(i === 0 ? 5 : 3, style.accent, i === 0 ? .95 : .65)
        .lineBetween(-36, y, 15, y).lineBetween(15, y, 2, y - 7).lineBetween(15, y, 2, y + 7);
    }
    g.lineStyle(5, style.color, .65).beginPath().arc(-22, 0, 24, -.9, .9).strokePath();
    return g;
  }
  private echo(kind: string, size: number) {
    const key = HERO_ASSET_KEYS[kind] ?? TROOP_ASSET_KEYS[kind as keyof typeof TROOP_ASSET_KEYS];
    return key ? this.paint(key, size) : this.paint("fx-silver", size, size * .3);
  }

  attack(event: CombatEffectEvent, source: Point, target: Point, reduced: boolean) {
    const style = battleAttackStyle(event.unitKind);
    const angle = Phaser.Math.Angle.Between(source.x, source.y, target.x, target.y);
    const heavy = event.special;
    const hit = () => {
      this.sparks(target, style, angle, heavy, reduced);
      if (event.skillName === "晕眩") this.stun(target, reduced);
      if (style.variant === "slash") this.slash(target, style, angle, heavy ? 142 : 78, reduced);
      if (style.variant === "charge" && !reduced) this.dust(target, event.unitKind === "黄盖" ? 1.3 : .8);
      if (event.skillName === "圣剑") {
        const sword = this.group(target);
        if (sword) { sword.add(this.paint("fx-holy", 72, 145)); sword.setAlpha(.8); this.fade(sword, reduced ? 100 : 300); }
      }
      this.damage(target, event, reduced);
    };
    if (event.skillName === "七进七出") {
      const pulse = this.group(target);
      if (pulse) {
        for (let i = 0; i < (reduced ? 1 : 3); i++) {
          pulse.add(this.paint("fx-silver", 104, 50).setRotation(angle + (i - 1) * .35));
        }
        this.fade(pulse, reduced ? 180 : 220);
      }
      hit(); return;
    }
    if (reduced) {
      // Reduced motion removes flourish, not essential attack feedback. A
      // short, single linear trace still explains why the target takes damage.
      const root = this.group(source); if (!root) { hit(); return; }
      root.add(style.variant === "arrow" ? this.arrow(style, event.unitKind === "黄忠")
        : style.variant === "spear" ? this.paint("fx-silver", 100, 48)
        : style.variant === "charge" ? this.chargeTrail(style) : this.blade(style, 70)).setRotation(angle);
      this.scene.tweens.add({ targets: root, x: target.x, y: target.y, duration: 140, ease: "Linear",
        onComplete: () => { root.destroy(); hit(); } });
      return;
    }
    if (event.skillName === "圣剑") { hit(); return; }
    if (event.skillName === "跳斩") {
      const leap = this.group(source); if (!leap) return;
      leap.add(this.echo(event.unitKind, 104)).setAlpha(.68);
      this.scene.tweens.add({ targets: leap, x: (source.x + target.x) / 2, y: Math.min(source.y, target.y) - 68,
        duration: 140, ease: "Quad.Out", onComplete: () => this.scene.tweens.add({
          targets: leap, x: target.x, y: target.y, duration: 95, ease: "Cubic.In",
          onComplete: () => { leap.destroy(); this.slash(target, style, angle, 168, false); this.dust(target); hit(); },
        }) });
      return;
    }

    // The silhouette and timing carry the identity, not just a recoloured ball.
    const requestedStrikes = event.unitKind === "赵云" ? Math.min(5, Math.max(1, event.hitCount))
      : event.unitKind === "刘备" || event.unitKind === "关兴" ? 2 : 1;
    const strikes = Math.min(requestedStrikes, 36 - this.active);
    for (let i = 0; i < strikes; i++) {
      const root = this.group(source); if (!root) break;
      const offset = (i - (strikes - 1) / 2) * 7;
      root.x += Math.cos(angle + Math.PI / 2) * offset;
      root.y += Math.sin(angle + Math.PI / 2) * offset;
      if (style.variant === "arrow") root.add(this.arrow(style, event.unitKind === "黄忠")).setRotation(angle);
      else if (style.variant === "spear") root.add(this.paint("fx-silver", heavy ? 132 : 105, heavy ? 64 : 50).setTint(style.accent)).setRotation(angle);
      else if (style.variant === "slash") root.add(this.blade(style, 82)).setRotation(angle - .6);
      else { root.add(this.chargeTrail(style)).setRotation(angle); this.dust(source, .7); }
      const windup = style.variant === "slash" ? 65 : style.variant === "arrow" ? 45 : 25;
      root.setScale(.65);
      this.scene.tweens.add({ targets: root, scale: 1, delay: i * 32, duration: windup, onComplete: () => {
        this.scene.tweens.add({ targets: root, x: target.x, y: target.y,
          rotation: style.variant === "slash" ? angle + .55 : root.rotation,
          duration: style.duration, ease: style.variant === "arrow" ? "Linear" : "Cubic.In",
          onComplete: () => { root.destroy(); if (i === strikes - 1) hit(); },
        });
      } });
    }
  }

  private damage(point: Point, event: CombatEffectEvent, reduced: boolean) {
    const root = this.group({ x: point.x, y: point.y - 18 }); if (!root) return;
    const amount = Math.max(0, Math.round(event.damage * 10) / 10);
    root.add(this.scene.add.text(0, 0, `−${amount}${event.hitCount > 1 ? ` · ${event.hitCount}命中` : ""}`, {
      fontFamily: '"Microsoft YaHei",sans-serif', fontSize: event.special ? "25px" : "18px",
      fontStyle: "bold", color: event.special ? "#ffe5a0" : "#fff8e6", stroke: "#2b3139", strokeThickness: 4,
    }).setOrigin(.5));
    this.scene.tweens.add({ targets: root, y: point.y - (reduced ? 24 : 57), duration: reduced ? 160 : 440, ease: "Cubic.Out" });
    this.fade(root, reduced ? 160 : 360, reduced ? 0 : 80);
  }

  cast(kind: string, skill: string, source: Point, target: Point, reduced: boolean) {
    const shape = ultimateShape(kind, skill), style = battleAttackStyle(kind);
    const angle = Phaser.Math.Angle.Between(source.x, source.y, target.x, target.y);
    if (shape === "stun") { this.stun(target, reduced); return; }
    if (shape === "leap") { this.slash(source, style, angle, 102, reduced); return; }
    if (shape === "shockwave") {
      const count = reduced ? 1 : kind === "张飞" ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const root = this.group(source); if (!root) break;
        root.add(this.paint("fx-thunder", 150, 112).setTint(style.accent)).setScale(.55).setAlpha(.9);
        this.scene.tweens.add({ targets: root, scale: reduced ? 1 : 1.9 + i * .25, alpha: 0,
          delay: i * 65, duration: reduced ? 120 : 430, ease: "Cubic.Out", onComplete: () => root.destroy() });
      }
      if (!reduced) this.dust(source, 1.5);
      return;
    }
    if (shape === "holy-sword") {
      const root = this.group(source); if (!root) return;
      root.add(this.paint("fx-holy", 66, 138)).setAlpha(.85);
      if (reduced) { this.fade(root, 130); return; }
      this.scene.tweens.add({ targets: root, y: source.y - 24, scale: 1.25, duration: 130, onComplete: () => {
        root.setRotation(angle + Math.PI / 2);
        this.scene.tweens.add({ targets: root, x: target.x, y: target.y, alpha: .3, duration: 310,
          ease: "Cubic.In", onComplete: () => root.destroy() });
      } });
      return;
    }
    if (shape === "phantom") {
      const root = this.group(source); if (!root) return;
      root.add(this.paint("fx-silver", 130, 62)).setRotation(angle).setAlpha(.95);
      this.scene.tweens.add({ targets: root, x: target.x, y: target.y, alpha: 0,
        duration: reduced ? 140 : 280, ease: "Linear", onComplete: () => root.destroy() });
      return;
    }
    if (shape === "fire-rain" || shape === "volley") {
      for (let i = 0; i < (reduced ? 1 : 3); i++) {
        const root = this.group(source); if (!root) break;
        root.add(this.arrow(style, shape === "fire-rain")).setRotation(-Math.PI / 2 + (i - 1) * .2);
        this.scene.tweens.add({ targets: root, x: source.x + (i - 1) * 35, y: source.y - (reduced ? 8 : 90),
          alpha: 0, delay: i * 35, duration: reduced ? 110 : 260, onComplete: () => root.destroy() });
      }
      return;
    }
    this.slash(target, style, angle, 130, reduced);
  }

  rain(point: Point, reduced: boolean) {
    const style = battleAttackStyle("黄忠");
    if (reduced) { this.sparks(point, style, Math.PI / 2, true, true); return; }
    const root = this.group({ x: point.x - 35, y: point.y - 120 }); if (!root) return;
    root.add(this.arrow(style, true)).setRotation(1.28);
    this.scene.tweens.add({ targets: root, x: point.x, y: point.y, duration: 135, ease: "Cubic.In", onComplete: () => {
      root.destroy(); this.sparks(point, style, -Math.PI / 2, true, false); this.dust(point, .8);
    } });
  }

  syncPhantoms(snapshot: MatchSnapshot, ownSlot: PlayerSlot, reduced: boolean) {
    const present = new Set<string>();
    for (const player of snapshot.players) for (const phantom of player.zhaoPhantoms ?? []) {
      const key = `${player.slot}:${phantom.id}`; present.add(key);
      const mirror = player.slot !== ownSlot;
      const x = ((mirror ? GAME_CONFIG.columns - 1 - phantom.x : phantom.x) + .5) * GAME_CONFIG.cellSize;
      const y = GAME_CONFIG.mapTop + ((mirror ? GAME_CONFIG.rows - 1 - phantom.y : phantom.y) + .5) * GAME_CONFIG.cellSize;
      let sprite = this.phantoms.get(key);
      if (!sprite) {
        sprite = this.paint("fx-silver", 100, 48).setPosition(x, y).setAlpha(.85);
        this.layer.add(sprite); this.phantoms.set(key, sprite);
      }
      const moving = Phaser.Math.Distance.Between(sprite.x, sprite.y, x, y) > 3;
      if (moving) sprite.setRotation(Phaser.Math.Angle.Between(sprite.x, sprite.y, x, y));
      // Long-lived simulation phantoms are not permanent running portraits.
      // Keep the active skill readable even in reduced motion; omit only trails.
      sprite.setVisible(phantom.launchMs <= 0 && player.phase === "battle");
      if (!reduced && moving && phantom.launchMs <= 0 && player.phase === "battle") {
        const trail = this.group(sprite);
        if (trail) {
          trail.add(this.paint("fx-silver", 84, 40)).setRotation(sprite.rotation).setAlpha(.18);
          this.fade(trail, 130);
        }
      }
      this.scene.tweens.killTweensOf(sprite);
      this.scene.tweens.add({ targets: sprite, x, y, duration: 100, ease: "Linear" });
    }
    for (const [key, sprite] of this.phantoms) if (!present.has(key)) {
      this.scene.tweens.killTweensOf(sprite); sprite.destroy(); this.phantoms.delete(key);
    }
  }
  destroy() {
    for (const root of this.groups) { this.scene.tweens.killTweensOf(root); root.destroy(); }
    this.groups.clear();
    for (const sprite of this.phantoms.values()) { this.scene.tweens.killTweensOf(sprite); sprite.destroy(); }
    this.phantoms.clear();
  }
}
