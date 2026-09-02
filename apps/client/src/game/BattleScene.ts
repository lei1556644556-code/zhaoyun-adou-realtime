import Phaser from "phaser";
import {
  GAME_CONFIG, GENERALS, MAP_LAYOUTS, SOLDIERS, cellCode, cellCoords, cellIndex, pathPoint,
  type CombatEffectEvent, type MatchSnapshot, type PlayerBattleState, type PlayerSlot,
} from "@adou/shared";
import { allImageAssets, HERO_ASSET_KEYS, IMAGE_ASSETS, TROOP_ASSET_KEYS } from "./assets";

const WIDTH = GAME_CONFIG.designWidth;
const HEIGHT = GAME_CONFIG.designHeight;
const MAP_TOP = GAME_CONFIG.mapTop;
const CELL = GAME_CONFIG.cellSize;
const CAMP_X = 95;
const CAMP_Y = 1050;
const CAMP_CELL = 90;

type DragSource = "reserve" | "unit" | "generalPart";

export class BattleScene extends Phaser.Scene {
  private snapshot: MatchSnapshot | null = null;
  private slot: PlayerSlot = 0;
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private tileLayer!: Phaser.GameObjects.Container;
  private stateLayer!: Phaser.GameObjects.Container;
  private effectsLayer!: Phaser.GameObjects.Container;
  private dragLayer!: Phaser.GameObjects.Container;
  private playedEffectIds = new Set<string>();
  private isDragging = false;
  private draggingId: string | null = null;
  private draggingType: DragSource | null = null;
  private draggingPartIndex: 0 | 1 | null = null;
  private mapSignature = "";

  constructor() { super("battle"); }

  preload() {
    for (const asset of allImageAssets()) this.load.image(asset.key, asset.path);
  }

  create() {
    this.cameras.main.setBackgroundColor("#edf0df");
    this.drawBackdrop();
    this.mapGraphics = this.add.graphics().setDepth(1);
    this.tileLayer = this.add.container(0, 0).setDepth(2);
    this.stateLayer = this.add.container(0, 0).setDepth(5);
    this.effectsLayer = this.add.container(0, 0).setDepth(80);
    this.dragLayer = this.add.container(0, 0).setDepth(1000);
    this.input.on("dragstart", (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.Container) => {
      this.isDragging = true;
      this.draggingId = object.getData("sourceId") as string;
      this.draggingType = object.getData("sourceType") as DragSource;
      this.draggingPartIndex = (object.getData("partIndex") as 0 | 1 | undefined) ?? null;
      this.stateLayer.remove(object, false);
      this.dragLayer.add(object);
      object.setScale(1.08);
      this.renderState();
    });
    this.input.on("drag", (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.Container, x: number, y: number) => {
      object.setPosition(x, y);
    });
    this.input.on("dragend", (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.Container) => {
      const sourceType = object.getData("sourceType") as DragSource;
      const id = object.getData("sourceId") as string;
      const partIndex = (object.getData("partIndex") as 0 | 1 | undefined) ?? null;
      const cell = this.pointToCell(object.x, object.y);
      const campSlot = this.pointToCampSlot(object.x, object.y);
      this.isDragging = false;
      this.draggingId = null;
      this.draggingType = null;
      this.draggingPartIndex = null;
      this.dragLayer.remove(object, true);
      if (cell !== null) this.game.events.emit("battle:drop", { sourceType, id, partIndex, targetCell: cell });
      else if (campSlot !== null && sourceType !== "generalPart") this.game.events.emit("battle:camp-drop", { sourceType, id, targetSlot: campSlot });
      else this.renderState();
    });
    this.game.events.on("battle:snapshot", this.onSnapshot, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off("battle:snapshot", this.onSnapshot, this);
    });
  }

  private drawBackdrop() {
    const paper = this.add.graphics();
    paper.fillStyle(0xf5f0df, 1).fillRect(0, 0, WIDTH, HEIGHT);
    paper.fillStyle(0xc6d7c1, 1).fillRect(0, MAP_TOP, WIDTH, 800);
    paper.fillStyle(0xe8e1cf, 1).fillRect(0, 1000, WIDTH, HEIGHT - 1000);
    paper.fillStyle(0x264a3d, 0.12);
    for (let i = 0; i < 34; i += 1) {
      const x = (i * 97) % WIDTH; const y = (i * 53) % HEIGHT;
      paper.fillCircle(x, y, 2 + (i % 4));
    }
    this.add.text(24, 18, "巨鹿战场", {
      fontFamily: '"STKaiti", "KaiTi", "Microsoft YaHei", serif', fontSize: "24px", color: "#4d5a4e", fontStyle: "bold",
    });
    this.add.text(WIDTH - 24, 24, "1.0.9 规则基线", {
      fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "15px", color: "#788178",
    }).setOrigin(1, 0);
  }

  private onSnapshot(snapshot: MatchSnapshot, slot: PlayerSlot) {
    this.snapshot = snapshot;
    this.slot = slot;
    this.renderState();
    this.playCombatEvents(snapshot.combatEvents ?? []);
  }

  private renderState() {
    if (!this.snapshot) return;
    this.stateLayer.removeAll(true);
    this.drawMap();
    const mine = this.snapshot.players[this.slot];
    const opponent = this.snapshot.players[this.slot === 0 ? 1 : 0];
    this.drawHud(mine, opponent);
    this.drawStructures(mine, opponent);
    this.drawEnemies(mine, false);
    this.drawEnemies(opponent, true);
    this.drawUnits(opponent, true, false);
    this.drawUnits(mine, false, true);
    this.drawCamp(mine);
    if (this.isDragging && this.draggingType) {
      const dragged = this.dragLayer.getAt(0) as Phaser.GameObjects.Container | null;
      this.drawDropHints(this.draggingType, dragged?.getData("kind") as string ?? "");
    }
    if (this.snapshot.phase === "finished") this.drawResult();
  }

  private drawMap() {
    if (!this.snapshot) return;
    const mine = this.snapshot.players[this.slot];
    const opponent = this.snapshot.players[this.slot === 0 ? 1 : 0];
    const signature = `${this.snapshot.mapIndex}:${mine.unlockedCells.join(",")}:${opponent.unlockedCells.join(",")}`;
    if (signature === this.mapSignature) return;
    this.mapSignature = signature;
    this.tileLayer.removeAll(true);
    const g = this.mapGraphics;
    g.clear();
    g.fillStyle(0x334f43, 1).fillRect(0, MAP_TOP, WIDTH, 800);
    const grid = this.add.graphics();
    for (let y = 0; y < GAME_CONFIG.rows; y += 1) for (let x = 0; x < GAME_CONFIG.columns; x += 1) {
      const code = cellCode(this.snapshot.mapIndex, cellIndex(x, y));
      const type = Number(code[0]);
      const side = Number(code[2]);
      const px = x * CELL; const py = MAP_TOP + y * CELL;
      const canonical = side === 0
        ? cellIndex(x, y)
        : cellIndex(GAME_CONFIG.columns - 1 - x, GAME_CONFIG.rows - 1 - y);
      const opened = type === 1 || (type === 2 && (side === 0 ? mine : opponent).unlockedCells.includes(canonical));
      const asset = type === 0 ? IMAGE_ASSETS.tiles.road : opened ? IMAGE_ASSETS.tiles.deployment : IMAGE_ASSETS.tiles.grass;
      const tile = this.add.image(px + CELL / 2, py + CELL / 2, asset.key).setDisplaySize(CELL - 2, CELL - 2);
      if (side === 1) tile.setTint(type === 0 ? 0xd5e5df : 0xdcebea);
      this.tileLayer.add(tile);
      if (type === 0) {
        grid.lineStyle(2, 0x6c4a34, 0.34).strokeRoundedRect(px + 3, py + 3, CELL - 6, CELL - 6, 10);
      } else if (opened) {
        grid.lineStyle(3, side === 0 ? 0x42675b : 0x55777a, 0.78).strokeRoundedRect(px + 5, py + 5, CELL - 10, CELL - 10, 7);
        grid.lineStyle(1, 0xfff9df, 0.8).strokeRoundedRect(px + 9, py + 9, CELL - 18, CELL - 18, 5);
      } else {
        grid.lineStyle(1, 0x294f42, 0.3).strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
      }
    }
    grid.lineStyle(4, 0xfff2c8, 0.9).lineBetween(0, MAP_TOP + 400, WIDTH, MAP_TOP + 400);
    grid.lineStyle(2, 0x233e35, 0.5).lineBetween(0, MAP_TOP, WIDTH, MAP_TOP);
    grid.lineBetween(0, MAP_TOP + 800, WIDTH, MAP_TOP + 800);
    this.tileLayer.add(grid);
  }

  private drawHud(mine: PlayerBattleState, opponent: PlayerBattleState) {
    if (!this.snapshot) return;
    const add = (object: Phaser.GameObjects.GameObject) => { this.stateLayer.add(object); return object; };
    add(this.add.rectangle(320, 99, 640, 158, 0xf8f4e8, 0.94).setStrokeStyle(2, 0x9d947c, 0.25));
    add(this.add.circle(70, 103, 40, 0x435e57, 1).setStrokeStyle(4, 0xd5ba78, 1));
    add(this.add.text(70, 101, "敌", { fontFamily: '"KaiTi", serif', fontSize: "38px", color: "#fff1cf", fontStyle: "bold" }).setOrigin(0.5));
    add(this.add.text(126, 73, "对手", { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "19px", color: "#5f675f" }));
    add(this.add.text(126, 105, `阿斗  ${"♥".repeat(opponent.hp)}${"♡".repeat(Math.max(0, opponent.maxHp - opponent.hp))}`, {
      fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "23px", color: "#bb4b43", fontStyle: "bold",
    }));
    const seconds = mine.phase === "preparing" ? Math.max(0, Math.ceil(mine.prepareMs / 1000)) : mine.wave;
    add(this.add.circle(320, 102, 57, 0x42665a, 1).setStrokeStyle(5, 0xe0c486, 1));
    add(this.add.text(320, 82, mine.phase === "preparing" ? "备战" : "波次", { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "17px", color: "#dce8dd" }).setOrigin(0.5));
    add(this.add.text(320, 113, String(seconds), { fontFamily: '"Arial", sans-serif', fontSize: "35px", color: "#fff3c7", fontStyle: "bold" }).setOrigin(0.5));
    add(this.add.text(574, 71, `第 ${mine.wave} / ${GAME_CONFIG.maxWaves} 波`, { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "19px", color: "#59665e", fontStyle: "bold" }).setOrigin(1, 0));
    add(this.add.text(574, 108, MAP_LAYOUTS[this.snapshot.mapIndex]?.name ?? "巨鹿", { fontFamily: '"KaiTi", serif', fontSize: "27px", color: "#7d4935", fontStyle: "bold" }).setOrigin(1, 0));
    add(this.add.rectangle(116, 1023, 210, 38, 0x813f38, 0.97).setStrokeStyle(2, 0xe8c67c, 1));
    add(this.add.text(116, 1023, `我方阿斗  ♥ ${mine.hp} / ${mine.maxHp}`, {
      fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "20px", color: "#fff3ce", fontStyle: "bold",
    }).setOrigin(0.5));
    add(this.add.text(620, 1014, mine.lastEvent, {
      fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "15px", color: "#5f655f", align: "right",
      wordWrap: { width: 370 },
    }).setOrigin(1, 0));
  }

  private drawStructures(mine: PlayerBattleState, opponent: PlayerBattleState) {
    const add = (object: Phaser.GameObjects.GameObject) => { this.stateLayer.add(object); return object; };
    const fort = (x: number, y: number, top: boolean) => {
      add(this.add.circle(x, y, 33, top ? 0x425c58 : 0x69483f, 0.9).setStrokeStyle(3, 0xe4c68c, 0.95));
      const icon = this.add.image(x, y + 1, IMAGE_ASSETS.ui.fort.key).setDisplaySize(65, 65);
      if (top) icon.setTint(0xcbdedb);
      add(icon);
    };
    const adou = (x: number, y: number, top: boolean) => {
      add(this.add.circle(x, y, 32, top ? 0x5d7e7d : 0x668469, 0.92).setStrokeStyle(3, 0xffefc6, 1));
      const icon = this.add.image(x, y, IMAGE_ASSETS.ui.adou.key).setDisplaySize(62, 62);
      if (top) icon.setTint(0xd8e9e6);
      add(icon);
    };
    const ownPath = MAP_LAYOUTS[this.snapshot?.mapIndex ?? 0]?.path ?? MAP_LAYOUTS[0]!.path;
    const first = ownPath[0]!; const last = ownPath[ownPath.length - 1]!;
    fort((first[0] + 0.5) * CELL, MAP_TOP + (first[1] + 0.5) * CELL, false);
    adou((last[0] + 0.5) * CELL, MAP_TOP + (last[1] + 0.5) * CELL, false);
    fort((GAME_CONFIG.columns - 1 - first[0] + 0.5) * CELL, MAP_TOP + (GAME_CONFIG.rows - 1 - first[1] + 0.5) * CELL, true);
    adou((GAME_CONFIG.columns - 1 - last[0] + 0.5) * CELL, MAP_TOP + (GAME_CONFIG.rows - 1 - last[1] + 0.5) * CELL, true);
    void mine; void opponent;
  }

  private playCombatEvents(events: CombatEffectEvent[]) {
    for (const event of events.slice(0, 28)) {
      if (this.playedEffectIds.has(event.id)) continue;
      this.playedEffectIds.add(event.id);
      this.playAttackEffect(event);
    }
    if (this.playedEffectIds.size > 600) this.playedEffectIds.clear();
  }

  private playAttackEffect(event: CombatEffectEvent) {
    if (!this.snapshot) return;
    const mirror = event.slot !== this.slot;
    const source = this.effectCellPoint(event.sourceCell, event.secondaryCell, mirror);
    const targetPath = pathPoint(this.snapshot.mapIndex, event.targetProgress);
    const target = {
      x: ((mirror ? GAME_CONFIG.columns - 1 - targetPath.x : targetPath.x) + 0.5) * CELL,
      y: MAP_TOP + ((mirror ? GAME_CONFIG.rows - 1 - targetPath.y : targetPath.y) + 0.5) * CELL,
    };
    const style = this.attackStyle(event.unitKind);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const angle = Phaser.Math.Angle.Between(source.x, source.y, target.x, target.y);
    const trail = this.add.graphics();
    trail.lineStyle(event.special ? 9 : style.width + 4, style.color, event.special ? 0.22 : 0.12).lineBetween(source.x, source.y, target.x, target.y);
    trail.lineStyle(style.width, style.accent, 0.78).lineBetween(source.x, source.y, target.x, target.y);
    this.effectsLayer.add(trail);
    this.tweens.add({ targets: trail, alpha: 0, duration: reducedMotion ? 80 : 260, onComplete: () => trail.destroy() });

    const sourceFlash = this.add.circle(source.x, source.y, event.special ? 18 : 10, style.color, 0.82).setStrokeStyle(3, style.accent, 0.95);
    sourceFlash.setScale(0.4);
    this.effectsLayer.add(sourceFlash);
    this.tweens.add({
      targets: sourceFlash, scale: event.special ? 2.2 : 1.65, alpha: 0,
      duration: reducedMotion ? 90 : 240, ease: "Quad.easeOut", onComplete: () => sourceFlash.destroy(),
    });

    let projectile: Phaser.GameObjects.Shape;
    if (style.variant === "arrow") projectile = this.add.triangle(source.x, source.y, -13, -5, 14, 0, -13, 5, style.accent, 1);
    else if (style.variant === "spear") projectile = this.add.rectangle(source.x, source.y, event.special ? 40 : 29, event.special ? 8 : 5, style.accent, 1).setStrokeStyle(2, style.color, 1);
    else if (style.variant === "charge") projectile = this.add.circle(source.x, source.y, event.special ? 13 : 9, style.color, 1).setStrokeStyle(3, style.accent, 1);
    else projectile = this.add.triangle(source.x, source.y, -11, -9, 15, 0, -11, 9, style.color, 1).setStrokeStyle(2, style.accent, 1);
    projectile.setRotation(angle);
    this.effectsLayer.add(projectile);
    this.tweens.add({
      targets: projectile, x: target.x, y: target.y,
      duration: reducedMotion ? 70 : style.duration, ease: "Quad.easeIn",
      onComplete: () => {
        projectile.destroy();
        this.playImpactEffect(target.x, target.y, event, style, angle, reducedMotion);
      },
    });
  }

  private playImpactEffect(
    x: number,
    y: number,
    event: CombatEffectEvent,
    style: ReturnType<BattleScene["attackStyle"]>,
    angle: number,
    reducedMotion: boolean,
  ) {
    const ring = this.add.circle(x, y, event.special ? 25 : 15, style.color, 0.18).setStrokeStyle(event.special ? 7 : 4, style.accent, 1);
    this.effectsLayer.add(ring);
    this.tweens.add({
      targets: ring, scale: event.special ? 2.1 : 1.65, alpha: 0,
      duration: reducedMotion ? 100 : 330, ease: "Cubic.easeOut", onComplete: () => ring.destroy(),
    });

    if (style.variant === "slash") {
      const slash = this.add.graphics().setPosition(x, y).setRotation(angle - 0.7);
      slash.lineStyle(event.special ? 12 : 8, style.accent, 0.95).beginPath().arc(0, 0, event.special ? 37 : 28, -1.05, 1.05).strokePath();
      this.effectsLayer.add(slash);
      this.tweens.add({ targets: slash, rotation: slash.rotation + 1.4, scale: 1.35, alpha: 0, duration: reducedMotion ? 90 : 280, onComplete: () => slash.destroy() });
    }

    const particleCount = reducedMotion ? 3 : event.special ? 12 : Math.min(9, 5 + event.hitCount);
    for (let index = 0; index < particleCount; index += 1) {
      const particleAngle = (Math.PI * 2 * index / particleCount) + (event.id.length % 5) * 0.13;
      const distance = (event.special ? 42 : 27) + (index % 3) * 7;
      const particle = this.add.circle(x, y, event.special ? 5 : 3.5, index % 2 ? style.color : style.accent, 1);
      this.effectsLayer.add(particle);
      this.tweens.add({
        targets: particle, x: x + Math.cos(particleAngle) * distance, y: y + Math.sin(particleAngle) * distance,
        scale: 0.2, alpha: 0, duration: reducedMotion ? 100 : 300 + index * 12,
        ease: "Quad.easeOut", onComplete: () => particle.destroy(),
      });
    }

    const roundedDamage = Math.max(1, Math.round(event.damage * 10) / 10);
    const damageLabel = `${event.special ? "暴击 " : "−"}${roundedDamage}${event.hitCount > 1 ? ` ×${event.hitCount}` : ""}`;
    const damageText = this.add.text(x, y - 19, damageLabel, {
      fontFamily: '"Microsoft YaHei", sans-serif', fontSize: event.special ? "27px" : "20px",
      color: event.special ? "#fff0a8" : "#ffffff", fontStyle: "bold", stroke: "#6d2822", strokeThickness: 5,
    }).setOrigin(0.5);
    this.effectsLayer.add(damageText);
    this.tweens.add({
      targets: damageText, y: y - (event.special ? 70 : 53), alpha: 0,
      duration: reducedMotion ? 180 : event.special ? 720 : 520, ease: "Cubic.easeOut", onComplete: () => damageText.destroy(),
    });
    if (event.special && !reducedMotion) this.cameras.main.shake(110, 0.0025);
  }

  private attackStyle(kind: string) {
    if (["弓", "黄忠", "黄祖"].includes(kind)) return { variant: "arrow" as const, color: 0xc97a2b, accent: 0xffe49a, width: 3, duration: 210 };
    if (["枪", "赵云", "张飞", "张苞"].includes(kind)) return { variant: "spear" as const, color: 0x397f93, accent: 0xcff7ff, width: 4, duration: 170 };
    if (["骑", "马超", "张翼", "黄盖", "刘备"].includes(kind)) return { variant: "charge" as const, color: 0xc04b35, accent: 0xffc05f, width: 6, duration: 145 };
    return { variant: "slash" as const, color: 0xb92f32, accent: 0xffe29a, width: 5, duration: 125 };
  }

  private effectCellPoint(cell: number, secondaryCell: number | undefined, mirror: boolean) {
    const place = (value: number) => {
      const point = cellCoords(value);
      return {
        x: (mirror ? GAME_CONFIG.columns - 1 - point.x : point.x) + 0.5,
        y: (mirror ? GAME_CONFIG.rows - 1 - point.y : point.y) + 0.5,
      };
    };
    const first = place(cell);
    const second = secondaryCell === undefined ? first : place(secondaryCell);
    return { x: (first.x + second.x) * CELL / 2, y: MAP_TOP + (first.y + second.y) * CELL / 2 };
  }

  private drawCamp(mine: PlayerBattleState) {
    const add = (object: Phaser.GameObjects.GameObject) => { this.stateLayer.add(object); return object; };
    add(this.add.circle(50, CAMP_Y + 44, 37, 0x4c6255, 0.94).setStrokeStyle(3, 0xd8bb78, 1));
    add(this.add.image(50, CAMP_Y + 44, IMAGE_ASSETS.ui.camp.key).setDisplaySize(72, 72));
    for (let index = 0; index < GAME_CONFIG.reserveSize; index += 1) {
      const x = CAMP_X + index * CAMP_CELL + CAMP_CELL / 2;
      add(this.add.image(x, CAMP_Y + CAMP_CELL / 2, IMAGE_ASSETS.tiles.paper.key).setDisplaySize(CAMP_CELL - 6, CAMP_CELL - 6));
      add(this.add.rectangle(x, CAMP_Y + CAMP_CELL / 2, CAMP_CELL - 6, CAMP_CELL - 6, 0xffffff, 0)
        .setStrokeStyle(2, 0x756955, 0.62));
    }
    for (const item of mine.reserve) {
      if (this.draggingType === "reserve" && item.id === this.draggingId) continue;
      if (item.secondarySlot !== undefined && GENERALS[item.kind]) {
        const parts = item.parts ?? [item.kind[0] ?? "", item.kind[1] ?? ""];
        const firstX = CAMP_X + item.slot * CAMP_CELL + CAMP_CELL / 2;
        const secondX = CAMP_X + item.secondarySlot * CAMP_CELL + CAMP_CELL / 2;
        add(this.add.rectangle((firstX + secondX) / 2, CAMP_Y + CAMP_CELL / 2, Math.abs(secondX - firstX) + 70, 70, 0x765166, 0.94)
          .setStrokeStyle(4, 0xe9c56f, 1));
        const heroKey = HERO_ASSET_KEYS[item.kind];
        if (heroKey) add(this.add.image((firstX + secondX) / 2, CAMP_Y + CAMP_CELL / 2 + 1, heroKey).setDisplaySize(72, 72).setAlpha(0.62));
        ([item.slot, item.secondarySlot] as const).forEach((slot, partIndex) => {
          const token = this.createToken(CAMP_X + slot * CAMP_CELL + CAMP_CELL / 2, CAMP_Y + CAMP_CELL / 2, parts[partIndex] ?? "", item.level, false, true);
          this.enableDrag(token, "reserve", item.id, item.kind);
          add(token);
        });
        continue;
      }
      const token = this.createToken(CAMP_X + item.slot * CAMP_CELL + CAMP_CELL / 2, CAMP_Y + CAMP_CELL / 2, item.kind, item.level, false);
      this.enableDrag(token, "reserve", item.id, item.kind);
      add(token);
    }
    const enough = mine.buns + mine.reserve.length >= mine.recruitCost;
    const button = this.add.rectangle(320, 1222, 264, 112, enough ? 0xb96549 : 0x9a8f83, 1)
      .setStrokeStyle(5, 0xe7c57d, 1).setInteractive({ useHandCursor: enough });
    if (enough) button.on("pointerup", () => this.game.events.emit("battle:recruit"));
    add(button);
    add(this.add.text(320, 1202, "征 兵", { fontFamily: '"KaiTi", serif', fontSize: "42px", color: "#fff4d1", fontStyle: "bold" }).setOrigin(0.5));
    add(this.add.image(286, 1246, IMAGE_ASSETS.ui.bun.key).setDisplaySize(36, 36));
    add(this.add.text(312, 1245, String(mine.recruitCost), { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "23px", color: "#ffe8aa", fontStyle: "bold" }).setOrigin(0, 0.5));
    add(this.add.text(514, 1182, "馒头", { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "17px", color: "#736957" }).setOrigin(0.5));
    add(this.add.text(514, 1210, String(mine.buns), { fontFamily: '"Arial", sans-serif', fontSize: "36px", color: "#85513b", fontStyle: "bold" }).setOrigin(0.5));
    add(this.add.text(320, 1312, mine.reserve.length
      ? "棕路行军 · 白格布阵 · 绿地禁行；营地内也可移动/合成"
      : "棕路行军 · 白格布阵 · 绿地须用铲子开垦；点击征兵获得五枚",
    { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "17px", color: "#716d63", align: "center", wordWrap: { width: 590 } }).setOrigin(0.5, 0));
  }

  private drawUnits(player: PlayerBattleState, mirror: boolean, draggable: boolean) {
    for (const unit of player.units) {
      if (unit.secondaryCell !== undefined && GENERALS[unit.kind]) {
        this.drawGeneral(unit, mirror, draggable);
        continue;
      }
      if (draggable && this.draggingType === "unit" && unit.id === this.draggingId) continue;
      const point = cellCoords(unit.cell);
      const y = mirror ? GAME_CONFIG.rows - 1 - point.y : point.y;
      const x = mirror ? GAME_CONFIG.columns - 1 - point.x : point.x;
      const token = this.createToken((x + 0.5) * CELL, MAP_TOP + (y + 0.5) * CELL, unit.kind, unit.level, mirror);
      if (draggable) this.enableDrag(token, "unit", unit.id, unit.kind);
      this.stateLayer.add(token);
    }
  }

  private drawGeneral(unit: PlayerBattleState["units"][number], mirror: boolean, draggable: boolean) {
    if (unit.secondaryCell === undefined) return;
    const position = (cell: number) => {
      const point = cellCoords(cell);
      const y = mirror ? GAME_CONFIG.rows - 1 - point.y : point.y;
      const x = mirror ? GAME_CONFIG.columns - 1 - point.x : point.x;
      return { x: (x + 0.5) * CELL, y: MAP_TOP + (y + 0.5) * CELL };
    };
    const points = [position(unit.cell), position(unit.secondaryCell)] as const;
    const parts = unit.parts ?? [unit.kind[0] ?? "", unit.kind[1] ?? ""];
    const splitting = draggable && this.draggingType === "generalPart" && unit.id === this.draggingId;
    if (!splitting) {
      const centerX = (points[0].x + points[1].x) / 2;
      const centerY = (points[0].y + points[1].y) / 2;
      const horizontal = points[0].y === points[1].y;
      this.stateLayer.add(this.add.rectangle(centerX, centerY, horizontal ? 150 : 70, horizontal ? 70 : 150, mirror ? 0x526d72 : 0x765166, 0.92)
        .setStrokeStyle(4, 0xe9c56f, 1));
      const heroKey = HERO_ASSET_KEYS[unit.kind];
      if (heroKey) {
        const portrait = this.add.image(centerX, centerY + 1, heroKey).setDisplaySize(78, 78).setAlpha(0.66);
        if (mirror) portrait.setTint(0xc9dfdf);
        this.stateLayer.add(portrait);
      }
    }
    ([0, 1] as const).forEach((partIndex) => {
      if (splitting && this.draggingPartIndex === partIndex) return;
      const point = points[partIndex];
      const token = this.createToken(point.x, point.y, parts[partIndex], unit.level, mirror, true);
      if (draggable) this.enableDrag(token, "generalPart", unit.id, parts[partIndex], partIndex);
      this.stateLayer.add(token);
    });
  }

  private createToken(x: number, y: number, kind: string, level: number, opponent: boolean, generalPart = false) {
    const container = this.add.container(x, y);
    const isHero = Boolean(GENERALS[kind]) || generalPart;
    const isSoldier = Boolean(SOLDIERS[kind as keyof typeof SOLDIERS]);
    const artKey = TROOP_ASSET_KEYS[kind] ?? (kind === "铲子" ? IMAGE_ASSETS.ui.shovel.key : HERO_ASSET_KEYS[kind]);
    const disc = this.add.circle(0, 0, isHero ? 33 : 29, opponent ? 0x4d6b6b : isHero ? 0xa8513f : isSoldier ? 0x52765b : 0x78634d, 1)
      .setStrokeStyle(isHero ? 4 : 3, isHero ? 0xf0c86e : 0xf7edcd, 1);
    container.add(disc);
    if (artKey) container.add(this.add.image(0, 2, artKey).setDisplaySize(isHero ? 62 : 56, isHero ? 62 : 56).setAlpha(0.92));
    const compactLabel = Boolean(artKey);
    if (compactLabel) container.add(this.add.circle(-21, -20, 12, opponent ? 0x38575a : 0x3e5548, 0.96).setStrokeStyle(1.5, 0xf7edcd, 0.9));
    const fontSize = compactLabel ? 17 : kind.length > 1 ? 23 : 35;
    const label = this.add.text(compactLabel ? -21 : 0, compactLabel ? -21 : -2, kind === "铲子" ? "铲" : kind, {
      fontFamily: '"STKaiti", "KaiTi", "Microsoft YaHei", serif', fontSize: `${fontSize}px`, color: "#fff8dc", fontStyle: "bold",
      stroke: compactLabel ? "#263b32" : "#000000", strokeThickness: compactLabel ? 2 : 0,
    }).setOrigin(0.5);
    container.add(label);
    if (kind !== "铲子" && (isHero || isSoldier)) {
      const badge = this.add.circle(24, 23, 13, 0xb24738, 1).setStrokeStyle(2, 0xffe9ad, 1);
      const levelText = this.add.text(24, 23, String(level), { fontFamily: '"Arial", sans-serif', fontSize: "15px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5);
      container.add([badge, levelText]);
    }
    container.setSize(72, 72);
    return container;
  }

  private enableDrag(container: Phaser.GameObjects.Container, sourceType: DragSource, sourceId: string, kind: string, partIndex?: 0 | 1) {
    container.setData({ sourceType, sourceId, kind, partIndex });
    container.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(container);
  }

  private drawEnemies(player: PlayerBattleState, mirror: boolean) {
    if (!this.snapshot) return;
    for (const enemy of player.enemies) {
      const point = pathPoint(this.snapshot.mapIndex, enemy.progress);
      const y = mirror ? GAME_CONFIG.rows - 1 - point.y : point.y;
      const x = mirror ? GAME_CONFIG.columns - 1 - point.x : point.x;
      const px = (x + 0.5) * CELL; const py = MAP_TOP + (y + 0.5) * CELL;
      const seed = [...enemy.id].reduce((total, character) => total + character.charCodeAt(0), 0);
      const regularKeys = [IMAGE_ASSETS.enemies.rebel.key, IMAGE_ASSETS.enemies.brute.key, IMAGE_ASSETS.enemies.scout.key, IMAGE_ASSETS.enemies.captain.key];
      const bossKeys = [IMAGE_ASSETS.enemies.bossHorned.key, IMAGE_ASSETS.enemies.bossBanner.key];
      const imageKey = enemy.boss ? bossKeys[seed % bossKeys.length]! : regularKeys[seed % regularKeys.length]!;
      const size = enemy.boss ? 67 : 45;
      const radius = enemy.boss ? 29 : 19;
      const shadow = this.add.ellipse(px, py + radius * 0.7, enemy.boss ? 54 : 34, enemy.boss ? 16 : 10, 0x1f302b, 0.4);
      const frame = this.add.circle(px, py, radius, enemy.boss ? 0x8f2f2d : mirror ? 0x475c66 : 0x5e3c35, 0.88)
        .setStrokeStyle(enemy.boss ? 3 : 2, enemy.boss ? 0xffd06e : 0xf0e5cf, 0.96);
      const body = this.add.image(px, py + 1, imageKey).setDisplaySize(size, size);
      if (mirror) body.setTint(0xd4e5e3);
      const barBack = this.add.rectangle(px, py - radius - 9, enemy.boss ? 54 : 38, 6, 0x482c28, 1);
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      const bar = this.add.rectangle(px - (enemy.boss ? 27 : 19), py - radius - 9, (enemy.boss ? 54 : 38) * ratio, 6, 0xd75240, 1).setOrigin(0, 0.5);
      this.stateLayer.add([shadow, frame, body, barBack, bar]);
    }
  }

  private drawDropHints(sourceType: DragSource, kind: string) {
    if (!this.snapshot) return;
    const mine = this.snapshot.players[this.slot];
    const hint = this.add.graphics().setDepth(4);
    if (sourceType === "reserve" && kind === "铲子") {
      for (let cell = 0; cell < GAME_CONFIG.rows * GAME_CONFIG.columns; cell += 1) {
        if (cellCode(this.snapshot.mapIndex, cell) !== "2_0" || mine.unlockedCells.includes(cell)) continue;
        const point = cellCoords(cell);
        const adjacent = mine.unlockedCells.some((openCell) => {
          const open = cellCoords(openCell);
          return Math.abs(open.x - point.x) + Math.abs(open.y - point.y) === 1;
        });
        if (adjacent) hint.lineStyle(5, 0xffd35c, 0.9).strokeRoundedRect(point.x * CELL + 5, MAP_TOP + point.y * CELL + 5, CELL - 10, CELL - 10, 7);
      }
    } else {
      for (const cell of mine.unlockedCells) {
        const point = cellCoords(cell);
        hint.lineStyle(4, 0xffd35c, 0.75).strokeRoundedRect(point.x * CELL + 6, MAP_TOP + point.y * CELL + 6, CELL - 12, CELL - 12, 7);
      }
    }
    if (sourceType !== "generalPart") {
      for (let slot = 0; slot < GAME_CONFIG.reserveSize; slot += 1) {
        hint.lineStyle(4, 0xe4a943, 0.92).strokeRoundedRect(
          CAMP_X + slot * CAMP_CELL + 5, CAMP_Y + 5, CAMP_CELL - 10, CAMP_CELL - 10, 7,
        );
      }
    }
    this.stateLayer.add(hint);
  }

  private pointToCell(x: number, y: number) {
    if (x < 0 || x >= WIDTH || y < MAP_TOP || y >= MAP_TOP + GAME_CONFIG.rows * CELL) return null;
    const column = Math.floor(x / CELL); const row = Math.floor((y - MAP_TOP) / CELL);
    return cellIndex(column, row);
  }

  private pointToCampSlot(x: number, y: number) {
    if (x < CAMP_X || x >= CAMP_X + GAME_CONFIG.reserveSize * CAMP_CELL || y < CAMP_Y || y >= CAMP_Y + CAMP_CELL) return null;
    return Math.floor((x - CAMP_X) / CAMP_CELL);
  }

  private drawResult() {
    if (!this.snapshot) return;
    const mineWon = this.snapshot.winner === this.slot;
    const text = this.snapshot.winner === "draw" ? "平 局" : mineWon ? "守城成功" : "阿斗失守";
    this.stateLayer.add(this.add.rectangle(320, 600, 560, 230, 0x263a35, 0.95).setStrokeStyle(5, 0xe4c57f, 1));
    this.stateLayer.add(this.add.text(320, 565, text, { fontFamily: '"KaiTi", serif', fontSize: "58px", color: "#fff0bd", fontStyle: "bold" }).setOrigin(0.5));
    this.stateLayer.add(this.add.text(320, 640, "点击“退出本局”可重新开局", { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "21px", color: "#d8e1d8" }).setOrigin(0.5));
  }
}

export function createGame(parent: string) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: "#edf0df",
    transparent: false,
    render: { antialias: true, pixelArt: false },
    input: { activePointers: 3 },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BattleScene],
  });
}
