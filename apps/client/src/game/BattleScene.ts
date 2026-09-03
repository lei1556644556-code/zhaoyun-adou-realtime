import Phaser from "phaser";
import {
  GAME_CONFIG, GENERALS, MAP_LAYOUTS, PROPS, SOLDIERS, attackRangeIntersectsCell, cellCode, cellCoords, cellIndex,
  enemyPathPoint, pathPoint,
  type ActivePropId, type BattleEvent, type CombatEffectEvent, type HeroRarity, type MatchSnapshot, type PlayerBattleState, type PlayerSlot,
} from "@adou/shared";
import { allImageAssets, HERO_ASSET_KEYS, IMAGE_ASSETS, TROOP_ASSET_KEYS } from "./assets";
import {
  BATTLE_INPUT, BATTLE_LAYOUT, activePropDropTargetAt, battleDropTargetAt, createPointerGesture, isTapGesture, updatePointerGesture,
  resolveBattleInspection, worldDragThreshold,
  type ActivePropDropPayload, type BattleInspectSelection, type DragSource, type PointerGesture,
} from "./battleInteraction";

const WIDTH = GAME_CONFIG.designWidth;
const HEIGHT = GAME_CONFIG.designHeight;
const MAP_TOP = GAME_CONFIG.mapTop;
const CELL = GAME_CONFIG.cellSize;
const CAMP_X = BATTLE_LAYOUT.campX;
const CAMP_Y = BATTLE_LAYOUT.campY;
const CAMP_CELL = BATTLE_LAYOUT.campCell;

type PieceDisplayMode = "text" | "image";
type DragDescriptor =
  | { sourceType: "reserve" | "unit"; id: string }
  | { sourceType: "generalPart"; id: string; partIndex: 0 | 1 };
type PointerAction =
  | {
      type: "piece";
      object: Phaser.GameObjects.Container;
      inspectKind: string;
      level: number;
      selection?: BattleInspectSelection;
      drag?: DragDescriptor;
      offsetX: number;
      offsetY: number;
    }
  | { type: "recruit" };
type ActivePointer = { gesture: PointerGesture; action: PointerAction };
type PropDragPointer = { propId: ActivePropId; clientX: number; clientY: number };
const PIECE_DISPLAY_MODE_KEY = "adou-piece-display-mode-v1";

export class BattleScene extends Phaser.Scene {
  private snapshot: MatchSnapshot | null = null;
  private slot: PlayerSlot = 0;
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private tileLayer!: Phaser.GameObjects.Container;
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private stateLayer!: Phaser.GameObjects.Container;
  private propTargetGraphics!: Phaser.GameObjects.Graphics;
  private effectsLayer!: Phaser.GameObjects.Container;
  private dragLayer!: Phaser.GameObjects.Container;
  private playedEffectIds = new Set<string>();
  /** 从按下到释放由同一场景级状态机接管，避免 10Hz 快照替换按下时的对象。 */
  private activePointer: ActivePointer | null = null;
  private isDragging = false;
  private draggingId: string | null = null;
  private draggingType: DragSource | null = null;
  private draggingPartIndex: 0 | 1 | null = null;
  private selectedUnit: BattleInspectSelection | null = null;
  private activePropDrag: { propId: ActivePropId; hover: ActivePropDropPayload | null } | null = null;
  private mapSignature = "";
  private pieceDisplayMode: PieceDisplayMode = localStorage.getItem(PIECE_DISPLAY_MODE_KEY) === "text" ? "text" : "image";

  constructor() { super("battle"); }

  preload() {
    for (const asset of allImageAssets()) this.load.image(asset.key, asset.path);
  }

  create() {
    this.game.canvas.classList.remove("is-battle-ready");
    this.cameras.main.setBackgroundColor("#edf0df");
    this.drawBackdrop();
    this.mapGraphics = this.add.graphics().setDepth(1);
    this.tileLayer = this.add.container(0, 0).setDepth(2);
    this.selectionGraphics = this.add.graphics().setDepth(4);
    this.stateLayer = this.add.container(0, 0).setDepth(5);
    this.propTargetGraphics = this.add.graphics().setDepth(20);
    this.effectsLayer = this.add.container(0, 0).setDepth(80);
    this.dragLayer = this.add.container(0, 0).setDepth(1000);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUpOutside, this);
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if (this.activePointer) return;
      if (currentlyOver.length !== 0) return;
      this.clearInspection(true);
    });
    this.game.events.on("battle:snapshot", this.onSnapshot, this);
    this.game.events.on("battle:piece-mode", this.onPieceDisplayMode, this);
    this.game.events.on("battle:inspect-clear", this.onInspectClear, this);
    this.game.events.on("battle:prop-drag-start", this.onPropDragStart, this);
    this.game.events.on("battle:prop-drag-move", this.onPropDragMove, this);
    this.game.events.on("battle:prop-drag-end", this.onPropDragEnd, this);
    this.game.events.on("battle:prop-drag-cancel", this.onPropDragCancel, this);
    this.game.events.on(Phaser.Core.Events.BLUR, this.onPointerCancel, this);
    this.game.events.emit("battle:scene-ready");
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off("pointermove", this.onPointerMove, this);
      this.input.off("pointerup", this.onPointerUp, this);
      this.input.off("pointerupoutside", this.onPointerUpOutside, this);
      this.game.events.off("battle:snapshot", this.onSnapshot, this);
      this.game.events.off("battle:piece-mode", this.onPieceDisplayMode, this);
      this.game.events.off("battle:inspect-clear", this.onInspectClear, this);
      this.game.events.off("battle:prop-drag-start", this.onPropDragStart, this);
      this.game.events.off("battle:prop-drag-move", this.onPropDragMove, this);
      this.game.events.off("battle:prop-drag-end", this.onPropDragEnd, this);
      this.game.events.off("battle:prop-drag-cancel", this.onPropDragCancel, this);
      this.game.events.off(Phaser.Core.Events.BLUR, this.onPointerCancel, this);
      this.game.canvas.classList.remove("is-battle-ready");
      this.resetPointerState();
      this.onPropDragCancel();
    });
  }

  private pointerPoint(pointer: Phaser.Input.Pointer) {
    return { x: pointer.worldX, y: pointer.worldY };
  }

  private pointerThreshold(pointer: Phaser.Input.Pointer) {
    return worldDragThreshold(pointer.wasTouch, this.scale.displayScale);
  }

  private beginPiecePointer(
    pointer: Phaser.Input.Pointer,
    object: Phaser.GameObjects.Container,
    inspectKind: string,
    level: number,
    selection?: BattleInspectSelection,
    drag?: DragDescriptor,
  ) {
    if (this.activePointer || !pointer.primaryDown) return;
    const point = this.pointerPoint(pointer);
    this.activePointer = {
      gesture: createPointerGesture(pointer.id, point, this.pointerThreshold(pointer)),
      action: {
        type: "piece", object, inspectKind, level, selection, drag,
        offsetX: object.x - point.x, offsetY: object.y - point.y,
      },
    };
  }

  private beginRecruitPointer(pointer: Phaser.Input.Pointer) {
    if (this.activePointer || !pointer.primaryDown) return;
    const point = this.pointerPoint(pointer);
    this.activePointer = {
      gesture: createPointerGesture(pointer.id, point, this.pointerThreshold(pointer)),
      action: { type: "recruit" },
    };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.activePointer) return;
    const update = updatePointerGesture(this.activePointer.gesture, pointer.id, this.pointerPoint(pointer));
    if (!update.accepted) return;
    this.activePointer.gesture = update.gesture;
    const action = this.activePointer.action;
    if (action.type !== "piece" || !action.drag) return;
    if (update.beganDrag) this.beginPieceDrag(action);
    if (this.isDragging && action.object.active) {
      action.object.setPosition(pointer.worldX + action.offsetX, pointer.worldY + action.offsetY);
    }
  }

  private beginPieceDrag(action: Extract<PointerAction, { type: "piece" }>) {
    if (!action.drag || !action.object.active || action.object.parentContainer !== this.stateLayer) {
      this.onPointerCancel();
      return;
    }
    this.selectedUnit = null;
    this.game.events.emit("battle:inspect-hide");
    this.isDragging = true;
    this.draggingId = action.drag.id;
    this.draggingType = action.drag.sourceType;
    this.draggingPartIndex = action.drag.sourceType === "generalPart" ? action.drag.partIndex : null;
    this.stateLayer.remove(action.object, false);
    this.dragLayer.add(action.object);
    action.object.setScale(1.08).setRotation(0);
    this.game.canvas.classList.add("is-dragging");
    this.game.events.emit("battle:interaction-state", { phase: "dragging", sourceType: action.drag.sourceType, id: action.drag.id });
    this.renderState();
  }

  private onPointerUp(pointer: Phaser.Input.Pointer) {
    this.finishPointer(pointer, true);
  }

  private onPointerUpOutside(pointer: Phaser.Input.Pointer) {
    this.finishPointer(pointer, false);
  }

  private finishPointer(pointer: Phaser.Input.Pointer, releasedInside: boolean) {
    if (!this.activePointer || this.activePointer.gesture.pointerId !== pointer.id) return;
    const update = updatePointerGesture(this.activePointer.gesture, pointer.id, this.pointerPoint(pointer));
    this.activePointer.gesture = update.gesture;
    if (update.beganDrag && this.activePointer.action.type === "piece" && this.activePointer.action.drag) {
      this.beginPieceDrag(this.activePointer.action);
    }
    if (!this.activePointer) return;
    const active = { ...this.activePointer, gesture: update.gesture };
    const wasDragging = this.isDragging;
    this.activePointer = null;

    const drag = active.action.type === "piece" ? active.action.drag : undefined;
    if (active.action.type === "piece" && wasDragging && drag) {
      const { action } = active;
      if (action.object.active) action.object.setPosition(pointer.worldX + action.offsetX, pointer.worldY + action.offsetY);
      const target = releasedInside && action.object.active
        ? battleDropTargetAt({ x: action.object.x, y: action.object.y }, drag.sourceType)
        : { type: "outside" } as const;
      this.resetDragState(action.object);
      if (target.type === "cell") {
        if (drag.sourceType === "generalPart") {
          this.game.events.emit("battle:drop", { ...drag, targetCell: target.targetCell });
        } else {
          this.game.events.emit("battle:drop", { sourceType: drag.sourceType, id: drag.id, targetCell: target.targetCell });
        }
      } else if (target.type === "camp" && drag.sourceType !== "generalPart") {
        this.game.events.emit("battle:camp-drop", { sourceType: drag.sourceType, id: drag.id, targetSlot: target.targetSlot });
      }
      // 联机命令的新快照可能稍后才到；先用旧快照恢复原位，避免棋子在网络往返期间消失。
      this.renderState();
      return;
    }

    this.resetDragState();
    if (releasedInside && isTapGesture(active.gesture)) {
      if (active.action.type === "recruit") {
        this.game.events.emit("battle:recruit");
        return;
      }
      const inspection = active.action.selection && this.snapshot
        ? resolveBattleInspection(this.snapshot, active.action.selection)
        : { kind: active.action.inspectKind, level: active.action.level };
      if (!inspection) {
        this.clearInspection(true);
        return;
      }
      this.selectedUnit = active.action.selection ?? null;
      this.game.events.emit("battle:inspect", inspection);
      this.drawSelectedRange();
      return;
    }
  }

  private onPointerCancel() {
    if (!this.activePointer) return;
    const object = this.activePointer.action.type === "piece" ? this.activePointer.action.object : undefined;
    const wasDragging = this.isDragging;
    this.activePointer = null;
    this.resetDragState(object);
    if (wasDragging) this.renderState();
  }

  private resetDragState(object?: Phaser.GameObjects.Container) {
    this.isDragging = false;
    this.draggingId = null;
    this.draggingType = null;
    this.draggingPartIndex = null;
    this.game.canvas.classList.remove("is-dragging");
    if (object?.active && object.parentContainer === this.dragLayer) this.dragLayer.remove(object, true);
    this.game.events.emit("battle:interaction-state", { phase: "idle" });
  }

  private resetPointerState() {
    const object = this.activePointer?.action.type === "piece" ? this.activePointer.action.object : undefined;
    this.activePointer = null;
    this.resetDragState(object);
  }

  private clientToWorld(clientX: number, clientY: number) {
    const rect = this.game.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0
      || clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
    return {
      x: (clientX - rect.left) * WIDTH / rect.width,
      y: (clientY - rect.top) * HEIGHT / rect.height,
    };
  }

  private propDropAt(payload: PropDragPointer) {
    if (!this.snapshot) return null;
    const point = this.clientToWorld(payload.clientX, payload.clientY);
    return point ? activePropDropTargetAt(this.snapshot, this.slot, payload.propId, point) : null;
  }

  private onPropDragStart(propId: ActivePropId) {
    this.activePropDrag = { propId, hover: null };
    this.game.canvas.classList.add("is-prop-targeting");
    this.drawActivePropTargets();
  }

  private onPropDragMove(payload: PropDragPointer) {
    if (!this.activePropDrag || this.activePropDrag.propId !== payload.propId) return;
    this.activePropDrag.hover = this.propDropAt(payload);
    this.drawActivePropTargets();
  }

  private onPropDragEnd(payload: PropDragPointer) {
    if (!this.activePropDrag || this.activePropDrag.propId !== payload.propId) return;
    const target = this.propDropAt(payload);
    this.onPropDragCancel();
    if (target) this.game.events.emit("battle:prop-drop", target);
    else this.game.events.emit("battle:prop-drop-miss", { propId: payload.propId });
  }

  private onPropDragCancel() {
    this.activePropDrag = null;
    this.propTargetGraphics?.clear();
    this.game.canvas.classList.remove("is-prop-targeting");
  }

  private activePropTargetKey(target: ActivePropDropPayload | null) {
    if (!target) return "";
    if ("targetUnitId" in target) return `unit:${target.targetUnitId}`;
    if ("targetEnemyId" in target) return `enemy:${target.targetEnemyId}`;
    if ("targetCell" in target) return `cell:${target.targetCell}`;
    return `reserve:${target.reserveId}`;
  }

  private drawActivePropTargets() {
    const graphics = this.propTargetGraphics;
    graphics.clear();
    if (!this.snapshot || !this.activePropDrag) return;
    const { propId, hover } = this.activePropDrag;
    const targetType = PROPS[propId]?.target;
    const hoveredKey = this.activePropTargetKey(hover);
    const color = propId === 9 ? 0xff806c : propId === 8 ? 0xffd86f : 0xffe49a;
    const strokeTargetCell = (cell: number, key: string, mirror = false) => {
      const point = cellCoords(cell);
      const x = mirror ? GAME_CONFIG.columns - 1 - point.x : point.x;
      const y = mirror ? GAME_CONFIG.rows - 1 - point.y : point.y;
      const hovered = key === hoveredKey;
      graphics.fillStyle(color, hovered ? 0.38 : 0.13)
        .fillRoundedRect(x * CELL + 6, MAP_TOP + y * CELL + 6, CELL - 12, CELL - 12, 10);
      graphics.lineStyle(hovered ? 7 : 3, color, hovered ? 1 : 0.82)
        .strokeRoundedRect(x * CELL + 6, MAP_TOP + y * CELL + 6, CELL - 12, CELL - 12, 10);
    };

    if (targetType === "road-cell") {
      for (let cell = 0; cell < GAME_CONFIG.columns * GAME_CONFIG.rows; cell += 1) {
        if (cellCode(this.snapshot.mapIndex, cell) === "0_0") strokeTargetCell(cell, `cell:${cell}`);
      }
      return;
    }
    if (targetType === "own-unit") {
      for (const unit of this.snapshot.players[this.slot].units) {
        const key = `unit:${unit.id}`;
        strokeTargetCell(unit.cell, key);
        if (unit.secondaryCell !== undefined) strokeTargetCell(unit.secondaryCell, key);
      }
      return;
    }
    if (targetType === "enemy-area") {
      const opponent = this.snapshot.players[this.slot === 0 ? 1 : 0];
      for (const unit of opponent.units) {
        const key = `enemy:${unit.id}`;
        strokeTargetCell(unit.cell, key, true);
        if (unit.secondaryCell !== undefined) strokeTargetCell(unit.secondaryCell, key, true);
      }
      return;
    }
    if (targetType === "reserve") {
      const mine = this.snapshot.players[this.slot];
      for (const item of mine.reserve) {
        const key = `reserve:${item.id}`;
        for (const reserveSlot of item.secondarySlot === undefined ? [item.slot] : [item.slot, item.secondarySlot]) {
          const hovered = key === hoveredKey;
          graphics.fillStyle(color, hovered ? 0.38 : 0.13).fillRoundedRect(
            CAMP_X + reserveSlot * CAMP_CELL + 5, CAMP_Y + 5, CAMP_CELL - 10, CAMP_CELL - 10, 8,
          );
          graphics.lineStyle(hovered ? 7 : 3, color, hovered ? 1 : 0.82).strokeRoundedRect(
            CAMP_X + reserveSlot * CAMP_CELL + 5, CAMP_Y + 5, CAMP_CELL - 10, CAMP_CELL - 10, 8,
          );
        }
      }
    }
  }

  private onInspectClear() {
    this.clearInspection(false);
  }

  private clearInspection(hidePanel: boolean) {
    if (!this.selectedUnit && !hidePanel) return;
    this.selectedUnit = null;
    if (hidePanel) this.game.events.emit("battle:inspect-hide");
    this.drawSelectedRange();
  }

  private onPieceDisplayMode(mode: PieceDisplayMode) {
    this.pieceDisplayMode = mode;
    this.renderState();
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
    const previous = this.snapshot;
    const previousRoom = this.snapshot?.roomId;
    this.snapshot = snapshot;
    this.slot = slot;
    if (!this.activePointer || this.isDragging) this.renderState();
    this.playBattleEvents(snapshot.events ?? []);
    // The canvas exists before preload/create and the first authoritative
    // snapshot finish. Only expose it after interactive pieces have rendered,
    // otherwise a player's first click can land on an inert loading canvas.
    this.game.canvas.classList.add("is-battle-ready");
    if (previous && previousRoom === snapshot.roomId) this.playSynthesisDiff(previous.players[slot], snapshot.players[slot]);
  }

  private playSynthesisDiff(before: PlayerBattleState, after: PlayerBattleState) {
    const prior = new Map([...before.units, ...before.reserve].map((item) => [item.id, { kind: item.kind, level: item.level }]));
    const result = [...after.units, ...after.reserve].find((item) => {
      const previous = prior.get(item.id);
      return previous && (item.level > previous.level || (item.kind !== previous.kind && Boolean(GENERALS[item.kind])));
    });
    if (!result) return;
    const general = GENERALS[result.kind];
    if (general) this.playHeroFusion(result.kind, result.level, general.rarity);
    else this.playUpgradeBurst(result.kind, result.level);
  }

  private renderState() {
    if (!this.snapshot) return;
    this.stateLayer.removeAll(true);
    this.drawMap();
    const mine = this.snapshot.players[this.slot];
    const opponent = this.snapshot.players[this.slot === 0 ? 1 : 0];
    this.drawSelectedRange();
    this.drawHud(mine, opponent);
    this.drawStructures(mine, opponent);
    this.drawEnemies(mine, false);
    this.drawEnemies(opponent, true);
    this.drawUnits(opponent, true, false);
    this.drawUnits(mine, false, true);
    this.drawCamp(mine);
    this.drawBulldozer(mine, false);
    this.drawBulldozer(opponent, true);
    if ((mine.visionDarkMs ?? 0) > 0) {
      this.stateLayer.add(this.add.rectangle(WIDTH / 2, MAP_TOP + 400, WIDTH, 800, 0x08121b, 0.67).setDepth(70));
      this.stateLayer.add(this.add.text(WIDTH / 2, MAP_TOP + 400, "噬 目", {
        fontFamily: '"STKaiti", "KaiTi", serif', fontSize: "72px", color: "#9ccfff", fontStyle: "bold",
        stroke: "#071019", strokeThickness: 8,
      }).setOrigin(0.5).setAlpha(0.64).setDepth(71));
    }
    this.drawActivePropTargets();
    if (this.isDragging && this.draggingType) {
      const dragged = this.dragLayer.getAt(0) as Phaser.GameObjects.Container | null;
      this.drawDropHints(this.draggingType, dragged?.getData("kind") as string ?? "");
    }
    if (this.snapshot.phase === "finished") this.drawResult();
  }

  private drawSelectedRange() {
    const graphics = this.selectionGraphics;
    graphics.clear();
    if (!this.snapshot || !this.selectedUnit) return;
    if (!this.selectedUnit.unitId) return;
    const owner = this.snapshot.players[this.selectedUnit.ownerSlot];
    const unit = owner.units.find((candidate) => candidate.id === this.selectedUnit?.unitId);
    const stats = unit ? (GENERALS[unit.kind] ?? SOLDIERS[unit.kind as keyof typeof SOLDIERS]) : undefined;
    if (!unit || !stats) {
      this.selectedUnit = null;
      this.game.events.emit("battle:inspect-hide");
      return;
    }
    const mirror = owner.slot !== this.slot;
    const first = cellCoords(unit.cell);
    const second = unit.secondaryCell === undefined ? first : cellCoords(unit.secondaryCell);
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const range = stats.range * (unit.rangeMultiplier ?? 1);
    const alpha = 0.2;
    const color = mirror ? 0x7ec7d0 : 0xffd35c;
    for (let y = 0; y < GAME_CONFIG.rows; y += 1) for (let x = 0; x < GAME_CONFIG.columns; x += 1) {
      const code = cellCode(this.snapshot.mapIndex, cellIndex(x, y));
      const roadSide = Number(code[2]);
      if (Number(code[0]) !== 0 || roadSide !== (mirror ? 1 : 0)) continue;
      const canonicalX = mirror ? GAME_CONFIG.columns - 1 - x : x;
      const canonicalY = mirror ? GAME_CONFIG.rows - 1 - y : y;
      if (!attackRangeIntersectsCell(center, { x: canonicalX, y: canonicalY }, range)) continue;
      const px = x * CELL + 7;
      const py = MAP_TOP + y * CELL + 7;
      graphics.fillStyle(color, alpha).fillRoundedRect(px, py, CELL - 14, CELL - 14, 9);
      graphics.lineStyle(3, color, 0.88).strokeRoundedRect(px, py, CELL - 14, CELL - 14, 9);
    }
    const displayedFirst = mirror
      ? { x: GAME_CONFIG.columns - 1 - first.x, y: GAME_CONFIG.rows - 1 - first.y }
      : first;
    const displayedSecond = mirror
      ? { x: GAME_CONFIG.columns - 1 - second.x, y: GAME_CONFIG.rows - 1 - second.y }
      : second;
    for (const point of [displayedFirst, displayedSecond]) {
      graphics.lineStyle(5, color, 1).strokeCircle((point.x + 0.5) * CELL, MAP_TOP + (point.y + 0.5) * CELL, 36);
    }
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
    const placedProps = (player: PlayerBattleState, mirror: boolean) => {
      for (const placed of player.props?.placed ?? []) {
        const source = cellCoords(placed.cell);
        const x = mirror ? GAME_CONFIG.columns - 1 - source.x : source.x;
        const y = mirror ? GAME_CONFIG.rows - 1 - source.y : source.y;
        const px = (x + 0.5) * CELL; const py = MAP_TOP + (y + 0.5) * CELL;
        add(this.add.circle(px, py, 24, placed.propId === 8 ? 0x5d3e2d : 0x75352e, 0.94)
          .setStrokeStyle(3, placed.propId === 8 ? 0xffd46d : 0xff846b, 1));
        add(this.add.text(px, py, placed.propId === 8 ? "陷" : "雷", {
          fontFamily: '"KaiTi", serif', fontSize: "26px", color: "#fff0c4", fontStyle: "bold",
        }).setOrigin(0.5));
      }
    };
    placedProps(mine, false);
    placedProps(opponent, true);
  }

  private drawBulldozer(player: PlayerBattleState, mirror: boolean) {
    const bulldozer = player.props?.bulldozer;
    if (!bulldozer) return;
    const x = ((mirror ? GAME_CONFIG.columns - 1 - bulldozer.x : bulldozer.x) + 0.5) * CELL;
    const y = MAP_TOP + ((mirror ? GAME_CONFIG.rows - 1 - bulldozer.y : bulldozer.y) + 0.5) * CELL;
    const alpha = bulldozer.phase === "fading" ? Math.max(0, bulldozer.fadeMs / 5_000) : 1;
    const body = this.add.container(x, y).setAlpha(alpha).setDepth(32);
    body.add([
      this.add.ellipse(0, 24, 66, 18, 0x1f2925, 0.45),
      this.add.rectangle(0, 2, 62, 42, 0x986238, 1).setStrokeStyle(4, 0xf2ca70, 1),
      this.add.rectangle(mirror ? 34 : -34, 9, 22, 50, 0xc49a58, 1).setStrokeStyle(3, 0x5f3828, 1),
      this.add.text(0, 0, "车", { fontFamily: '"KaiTi", serif', fontSize: "30px", color: "#fff0bc", fontStyle: "bold" }).setOrigin(0.5),
    ]);
    this.stateLayer.add(body);
  }

  private ownPiecePoint(kind: string, level: number) {
    if (!this.snapshot) return { x: WIDTH / 2, y: MAP_TOP + 560 };
    const mine = this.snapshot.players[this.slot];
    const unit = mine.units.find((candidate) => candidate.kind === kind && candidate.level === level)
      ?? mine.units.find((candidate) => candidate.kind === kind);
    if (unit) return this.effectCellPoint(unit.cell, unit.secondaryCell, false);
    const reserve = mine.reserve.find((candidate) => candidate.kind === kind && candidate.level === level)
      ?? mine.reserve.find((candidate) => candidate.kind === kind);
    if (reserve) {
      const first = CAMP_X + reserve.slot * CAMP_CELL + CAMP_CELL / 2;
      const second = reserve.secondarySlot === undefined
        ? first
        : CAMP_X + reserve.secondarySlot * CAMP_CELL + CAMP_CELL / 2;
      return { x: (first + second) / 2, y: CAMP_Y + CAMP_CELL / 2 };
    }
    return { x: WIDTH / 2, y: MAP_TOP + 560 };
  }

  private levelColor(level: number) {
    return [0xf4ecd2, 0x70b784, 0x72b9d5, 0xb786ef, 0xf3c45f][Math.max(0, Math.min(4, level - 1))] ?? 0xf4ecd2;
  }

  private playUpgradeBurst(kind: string, level: number) {
    const point = this.ownPiecePoint(kind, level);
    const color = this.levelColor(level);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ring = this.add.circle(point.x, point.y, 32, color, 0.16).setStrokeStyle(7, color, 1);
    const core = this.add.circle(point.x, point.y, 24, 0xfff5c8, 0.82);
    const title = this.add.text(point.x, point.y - 46, `升 至 Lv.${level}`, {
      fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "25px", color: "#fff8d9", fontStyle: "bold",
      stroke: "#51352e", strokeThickness: 6,
    }).setOrigin(0.5);
    this.effectsLayer.add([ring, core, title]);
    ring.setScale(0.35); core.setScale(0.25); title.setScale(0.75);
    this.tweens.add({ targets: [ring, core], scale: level >= 4 ? 2.4 : 1.9, alpha: 0, duration: reducedMotion ? 100 : 520, ease: "Cubic.easeOut" });
    this.tweens.add({
      targets: title, y: point.y - 85, scale: 1, alpha: { from: 1, to: 0 },
      duration: reducedMotion ? 180 : 720, ease: "Back.easeOut",
      onComplete: () => { ring.destroy(); core.destroy(); title.destroy(); },
    });
    const count = reducedMotion ? 4 : 10 + level * 2;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * 2 * index / count;
      const spark = this.add.rectangle(point.x, point.y, level >= 4 ? 7 : 5, 18, index % 2 ? color : 0xfff0a6, 1).setRotation(angle);
      this.effectsLayer.add(spark);
      this.tweens.add({
        targets: spark,
        x: point.x + Math.cos(angle) * (48 + level * 8),
        y: point.y + Math.sin(angle) * (48 + level * 8),
        scaleY: 0.1, alpha: 0, duration: reducedMotion ? 120 : 400 + index * 10,
        ease: "Quad.easeOut", onComplete: () => spark.destroy(),
      });
    }
    if (level >= 4 && !reducedMotion) this.cameras.main.shake(100, 0.0018);
  }

  private playHeroFusion(kind: string, level: number, rarity: HeroRarity) {
    const gold = rarity === "gold";
    const primary = gold ? 0xf4c75f : 0xb986f1;
    const deep = gold ? 0x7d352b : 0x4f326f;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.playUpgradeBurst(kind, level);
    const panel = this.add.container(WIDTH / 2, 610);
    const shade = this.add.rectangle(0, 0, 570, 260, 0x172922, 0.94).setStrokeStyle(5, primary, 1);
    const inner = this.add.rectangle(0, 0, 544, 234, deep, 0.68).setStrokeStyle(2, 0xfff0bc, 0.65);
    const rays = this.add.graphics();
    for (let index = 0; index < 20; index += 1) {
      const angle = Math.PI * 2 * index / 20;
      rays.lineStyle(index % 2 ? 3 : 7, primary, index % 2 ? 0.34 : 0.18)
        .lineBetween(Math.cos(angle) * 52, Math.sin(angle) * 52, Math.cos(angle) * 210, Math.sin(angle) * 210);
    }
    const halo = this.add.circle(-145, 0, 75, primary, 0.18).setStrokeStyle(5, primary, 1);
    const portraitKey = HERO_ASSET_KEYS[kind];
    const portrait = portraitKey ? this.add.image(-145, 0, portraitKey).setDisplaySize(146, 146) : null;
    const rarityText = this.add.text(-145, -91, gold ? "金色武将" : "紫色武将", {
      fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "18px", color: gold ? "#ffe69a" : "#e5c8ff", fontStyle: "bold",
      stroke: "#38241f", strokeThickness: 4,
    }).setOrigin(0.5);
    const heroName = this.add.text(76, -34, kind, {
      fontFamily: '"STKaiti", "KaiTi", serif', fontSize: "68px", color: "#fff5cc", fontStyle: "bold",
      stroke: gold ? "#7e3727" : "#4c2b68", strokeThickness: 8,
    }).setOrigin(0.5);
    const levelText = this.add.text(76, 45, `合成成功  ·  Lv.${level}`, {
      fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "22px", color: gold ? "#ffd97e" : "#d9b5ff", fontStyle: "bold",
    }).setOrigin(0.5);
    panel.add([shade, inner, rays, halo]);
    if (portrait) panel.add(portrait);
    panel.add([rarityText, heroName, levelText]);
    panel.setScale(0.55).setAlpha(0);
    this.effectsLayer.add(panel);
    this.tweens.add({
      targets: panel, alpha: 1, scale: 1,
      duration: reducedMotion ? 80 : 280, ease: "Back.easeOut",
      onComplete: () => this.tweens.add({
        targets: panel, alpha: 0, scale: 1.06, delay: reducedMotion ? 180 : 900,
        duration: reducedMotion ? 100 : 260, ease: "Quad.easeIn", onComplete: () => panel.destroy(),
      }),
    });
    if (!reducedMotion) {
      this.tweens.add({ targets: rays, rotation: Math.PI / 5, duration: 1200, ease: "Sine.easeInOut" });
      this.cameras.main.flash(170, gold ? 255 : 196, gold ? 224 : 165, gold ? 134 : 255, false);
      this.cameras.main.shake(150, 0.0022);
    }
  }

  private playBattleEvents(events: BattleEvent[]) {
    for (const event of events.slice(0, 28)) {
      if (this.playedEffectIds.has(event.id)) continue;
      this.playedEffectIds.add(event.id);
      if (event.type === "attack") this.playAttackEffect(event);
      else if (event.type === "arrow-rain-impact") this.playArrowRainImpact(event);
      else if (event.type === "boss-skill" && event.phase !== "resolved") this.playBossSkill(event);
      else if (event.type === "bulldozer" && event.phase === "push") this.cameras.main.shake(90, 0.0018);
    }
    if (this.playedEffectIds.size > 600) this.playedEffectIds.clear();
  }

  private playArrowRainImpact(event: Extract<BattleEvent, { type: "arrow-rain-impact" }>) {
    const mirror = event.slot !== this.slot;
    const x = ((mirror ? GAME_CONFIG.columns - event.x : event.x)) * CELL;
    const y = MAP_TOP + ((mirror ? GAME_CONFIG.rows - event.y : event.y)) * CELL;
    const arrow = this.add.rectangle(x, y - 150, 5, 64, 0x8a4c2d, 1).setStrokeStyle(2, 0xffe7a3, 1).setRotation(0.12);
    this.effectsLayer.add(arrow);
    this.tweens.add({ targets: arrow, y, duration: 130, ease: "Cubic.easeIn", onComplete: () => {
      arrow.destroy();
      const ring = this.add.circle(x, y, 18, 0xf3ad43, 0.28).setStrokeStyle(5, 0xffe7a3, 1);
      this.effectsLayer.add(ring);
      this.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 360, onComplete: () => ring.destroy() });
    }});
  }

  private playBossSkill(event: Extract<BattleEvent, { type: "boss-skill" }>) {
    const intercepted = event.phase === "intercepted";
    const banner = this.add.container(WIDTH / 2, MAP_TOP + 400).setDepth(95).setAlpha(0);
    const plate = this.add.rectangle(0, 0, 430, 92, intercepted ? 0x2f624e : 0x711f25, 0.94)
      .setStrokeStyle(4, intercepted ? 0xb8f1ba : 0xffd177, 1);
    const text = this.add.text(0, 0, intercepted ? `降妖符·反噬 ${event.skillName}` : `Boss发动·${event.skillName}`, {
      fontFamily: '"STKaiti", "KaiTi", serif', fontSize: "34px", color: "#fff1bd", fontStyle: "bold",
    }).setOrigin(0.5);
    banner.add([plate, text]); this.effectsLayer.add(banner);
    this.tweens.add({ targets: banner, alpha: 1, scale: 1.06, duration: 180, yoyo: true, hold: 520, onComplete: () => banner.destroy() });
    if (!intercepted) this.cameras.main.shake(130, 0.0024);
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
    const sourceFlash = this.add.circle(source.x, source.y, event.special ? 22 : 14, style.color, 0.28).setStrokeStyle(4, style.accent, 0.92);
    this.effectsLayer.add(sourceFlash);
    this.tweens.add({ targets: sourceFlash, scale: 1.8, alpha: 0, duration: reducedMotion ? 80 : 220, onComplete: () => sourceFlash.destroy() });

    const projectile = this.add.container(source.x, source.y).setRotation(angle);
    if (style.variant === "arrow") {
      projectile.add([
        this.add.rectangle(-2, 0, event.special ? 46 : 34, event.special ? 5 : 3, 0x7b4028, 1),
        this.add.triangle(18, 0, -7, -7, 9, 0, -7, 7, style.accent, 1),
        this.add.triangle(-20, 0, -5, -8, 7, 0, -5, 0, 0xe7e3cf, 0.9),
        this.add.triangle(-20, 0, -5, 8, 7, 0, -5, 0, 0xe7e3cf, 0.9),
      ]);
    } else if (style.variant === "spear") {
      projectile.add([
        this.add.ellipse(-13, 0, event.special ? 68 : 48, event.special ? 18 : 11, style.color, 0.24),
        this.add.rectangle(-4, 0, event.special ? 62 : 44, event.special ? 7 : 4, style.accent, 1),
        this.add.triangle(27, 0, -12, -10, 14, 0, -12, 10, 0xffffff, 1),
      ]);
    } else if (style.variant === "charge") {
      projectile.add([
        this.add.ellipse(-3, 14, event.special ? 64 : 49, 16, 0x3c2b26, 0.42),
        this.add.circle(0, 0, event.special ? 28 : 22, style.color, 0.72).setStrokeStyle(4, style.accent, 1),
        this.add.triangle(6, 0, -18, -17, 22, 0, -18, 17, style.accent, 0.95),
        this.add.rectangle(-19, -10, event.special ? 22 : 16, 5, 0xffe6b0, 0.9),
        this.add.rectangle(-19, 10, event.special ? 22 : 16, 5, 0xffe6b0, 0.9),
      ]);
    } else {
      const crescent = this.add.graphics();
      crescent.lineStyle(event.special ? 14 : 10, style.accent, 1).beginPath().arc(0, 0, event.special ? 28 : 21, -1.2, 1.2).strokePath();
      projectile.add([this.add.circle(0, 0, event.special ? 24 : 17, style.color, 0.32), crescent]);
    }
    this.effectsLayer.add(projectile);

    if (!reducedMotion && style.variant === "charge") {
      for (let index = 1; index <= 5; index += 1) {
        const t = index / 6;
        const dust = this.add.circle(Phaser.Math.Linear(source.x, target.x, t), Phaser.Math.Linear(source.y, target.y, t) + 14, 8 + (index % 2) * 4, 0xc8aa78, 0.42);
        this.effectsLayer.add(dust);
        dust.setScale(0.4);
        this.tweens.add({ targets: dust, scale: 1.8, alpha: 0, delay: index * 24, duration: 260, onComplete: () => dust.destroy() });
      }
    }
    if (!reducedMotion && style.variant === "spear") {
      for (let index = 0; index < 3; index += 1) {
        const after = this.add.ellipse(source.x, source.y, 34 - index * 6, 8 - index, style.color, 0.24).setRotation(angle);
        this.effectsLayer.add(after);
        this.tweens.add({
          targets: after, x: target.x, y: target.y, alpha: 0, delay: 20 + index * 28,
          duration: style.duration + index * 28, onComplete: () => after.destroy(),
        });
      }
    }
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
    } else if (style.variant === "arrow") {
      for (let index = -1; index <= 1; index += 1) {
        const arrow = this.add.triangle(x + index * 8, y + index * 4, -9, -5, 10, 0, -9, 5, style.accent, 0.92).setRotation(angle + index * 0.18);
        this.effectsLayer.add(arrow);
        this.tweens.add({ targets: arrow, alpha: 0, y: arrow.y + 12, delay: 100, duration: reducedMotion ? 90 : 330, onComplete: () => arrow.destroy() });
      }
    } else if (style.variant === "spear") {
      const pierce = this.add.ellipse(x, y, event.special ? 104 : 76, event.special ? 25 : 17, style.accent, 0.62).setRotation(angle);
      const core = this.add.circle(x, y, event.special ? 18 : 12, 0xffffff, 0.9);
      this.effectsLayer.add([pierce, core]);
      this.tweens.add({ targets: pierce, scaleX: 1.7, scaleY: 0.1, alpha: 0, duration: reducedMotion ? 90 : 260, onComplete: () => pierce.destroy() });
      this.tweens.add({ targets: core, scale: 2.4, alpha: 0, duration: reducedMotion ? 90 : 220, onComplete: () => core.destroy() });
    } else if (style.variant === "charge") {
      for (let index = 0; index < (reducedMotion ? 3 : 7); index += 1) {
        const puff = this.add.circle(x + (index - 3) * 6, y + 10 + (index % 3) * 4, 9 + (index % 2) * 5, index % 2 ? 0xd0b27d : 0x8f6847, 0.58);
        this.effectsLayer.add(puff);
        this.tweens.add({
          targets: puff, x: puff.x + (index - 3) * 8, y: puff.y - 20 - (index % 3) * 8,
          scale: 1.8, alpha: 0, duration: reducedMotion ? 100 : 310 + index * 18, onComplete: () => puff.destroy(),
        });
      }
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
    const hasGoldShovels = Boolean(mine.props?.loadout.passive.some((prop) => prop.id === 24));
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
      const general = GENERALS[item.kind];
      if (item.secondarySlot !== undefined && general) {
        const rarity = general.rarity;
        const rarityColor = rarity === "gold" ? 0xf2c75c : 0xb584ec;
        const rarityFill = rarity === "gold" ? 0x754b2d : 0x53396f;
        const parts = item.parts ?? [item.kind[0] ?? "", item.kind[1] ?? ""];
        const firstX = CAMP_X + item.slot * CAMP_CELL + CAMP_CELL / 2;
        const secondX = CAMP_X + item.secondarySlot * CAMP_CELL + CAMP_CELL / 2;
        add(this.add.rectangle((firstX + secondX) / 2, CAMP_Y + CAMP_CELL / 2, Math.abs(secondX - firstX) + 76, 76, rarityFill, 0.96)
          .setStrokeStyle(5, rarityColor, 1));
        const heroKey = this.pieceDisplayMode === "image" ? HERO_ASSET_KEYS[item.kind] : undefined;
        if (heroKey) add(this.add.image((firstX + secondX) / 2, CAMP_Y + CAMP_CELL / 2 + 1, heroKey).setDisplaySize(92, 92).setAlpha(0.84));
        add(this.add.text((firstX + secondX) / 2, CAMP_Y + 13, rarity === "gold" ? "金" : "紫", {
          fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "15px", color: rarity === "gold" ? "#ffe49a" : "#efd9ff",
          fontStyle: "bold", stroke: "#372820", strokeThickness: 3,
        }).setOrigin(0.5));
        ([item.slot, item.secondarySlot] as const).forEach((slot, partIndex) => {
          const token = this.createToken(CAMP_X + slot * CAMP_CELL + CAMP_CELL / 2, CAMP_Y + CAMP_CELL / 2, parts[partIndex] ?? "", item.level, false, true, rarity);
          this.enableDrag(token, "reserve", item.id, item.kind, item.level, undefined, item.kind, { ownerSlot: this.slot, reserveId: item.id });
          add(token);
        });
        continue;
      }
      const token = this.createToken(CAMP_X + item.slot * CAMP_CELL + CAMP_CELL / 2, CAMP_Y + CAMP_CELL / 2, item.kind, item.level, false, false, undefined, hasGoldShovels);
      this.enableDrag(token, "reserve", item.id, item.kind, item.level, undefined, item.kind, { ownerSlot: this.slot, reserveId: item.id });
      add(token);
    }
    const enough = mine.buns + mine.reserve.length >= mine.recruitCost;
    const button = this.add.rectangle(320, 1222, 264, 112, enough ? 0xb96549 : 0x9a8f83, 1)
      .setStrokeStyle(5, 0xe7c57d, 1).setInteractive({ useHandCursor: enough });
    if (enough) button.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.beginRecruitPointer(pointer));
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
    const hasGoldShovels = Boolean(player.props?.loadout.passive.some((prop) => prop.id === 24));
    for (const unit of player.units) {
      if (unit.secondaryCell !== undefined && GENERALS[unit.kind]) {
        this.drawGeneral(unit, mirror, draggable);
        continue;
      }
      if (draggable && this.draggingType === "unit" && unit.id === this.draggingId) continue;
      const point = cellCoords(unit.cell);
      const y = mirror ? GAME_CONFIG.rows - 1 - point.y : point.y;
      const x = mirror ? GAME_CONFIG.columns - 1 - point.x : point.x;
      const token = this.createToken((x + 0.5) * CELL, MAP_TOP + (y + 0.5) * CELL, unit.kind, unit.level, mirror, false, undefined, hasGoldShovels);
      const selection = { unitId: unit.id, ownerSlot: player.slot } satisfies BattleInspectSelection;
      if (draggable) this.enableDrag(token, "unit", unit.id, unit.kind, unit.level, undefined, unit.kind, selection);
      else this.enableInspect(token, unit.kind, unit.level, selection);
      this.stateLayer.add(token);
    }
  }

  private drawGeneral(unit: PlayerBattleState["units"][number], mirror: boolean, draggable: boolean) {
    if (unit.secondaryCell === undefined) return;
    const general = GENERALS[unit.kind];
    if (!general) return;
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
      const rarity = general.rarity;
      const rarityColor = rarity === "gold" ? 0xf2c75c : 0xb584ec;
      const rarityFill = rarity === "gold" ? 0x754b2d : 0x53396f;
      this.stateLayer.add(this.add.rectangle(centerX, centerY, horizontal ? 156 : 76, horizontal ? 76 : 156, mirror ? 0x48666b : rarityFill, 0.96)
        .setStrokeStyle(5, rarityColor, 1));
      const heroKey = this.pieceDisplayMode === "image" ? HERO_ASSET_KEYS[unit.kind] : undefined;
      if (heroKey) {
        const portrait = this.add.image(centerX, centerY + 1, heroKey).setDisplaySize(94, 94).setAlpha(0.86);
        if (mirror) portrait.setTint(0xc9dfdf);
        this.stateLayer.add(portrait);
      }
      this.stateLayer.add(this.add.text(centerX, centerY - (horizontal ? 30 : 67), rarity === "gold" ? "金" : "紫", {
        fontFamily: '"Microsoft YaHei", sans-serif', fontSize: "15px", color: rarity === "gold" ? "#ffe49a" : "#efd9ff",
        fontStyle: "bold", stroke: "#372820", strokeThickness: 3,
      }).setOrigin(0.5));
    }
    ([0, 1] as const).forEach((partIndex) => {
      if (splitting && this.draggingPartIndex === partIndex) return;
      const point = points[partIndex];
      const token = this.createToken(point.x, point.y, parts[partIndex], unit.level, mirror, true, general.rarity);
      const selection = { unitId: unit.id, ownerSlot: mirror ? (this.slot === 0 ? 1 : 0) : this.slot } satisfies BattleInspectSelection;
      if (draggable) this.enableDrag(token, "generalPart", unit.id, parts[partIndex], unit.level, partIndex, unit.kind, selection);
      else this.enableInspect(token, unit.kind, unit.level, selection);
      this.stateLayer.add(token);
    });
  }

  private createToken(x: number, y: number, kind: string, level: number, opponent: boolean, generalPart = false, rarity?: HeroRarity, goldShovel = false) {
    const seed = [...kind].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const bob = this.snapshot && !this.isDragging ? Math.sin((this.snapshot.tick + seed) * 0.2) * 1.6 : 0;
    const container = this.add.container(x, y + bob).setRotation(this.snapshot && !this.isDragging ? Math.sin((this.snapshot.tick + seed) * 0.13) * 0.018 : 0);
    const isHero = Boolean(GENERALS[kind]) || generalPart;
    const isSoldier = Boolean(SOLDIERS[kind as keyof typeof SOLDIERS]);
    const artKey = this.pieceDisplayMode === "image"
      ? TROOP_ASSET_KEYS[kind] ?? (kind === "铲子" ? IMAGE_ASSETS.ui.shovel.key : HERO_ASSET_KEYS[kind])
      : undefined;
    const rarityColor = rarity === "gold" ? 0xf3c45f : rarity === "purple" ? 0xb98aef : this.levelColor(level);
    const heroFill = rarity === "gold" ? 0x7c4530 : rarity === "purple" ? 0x593c72 : 0xa8513f;
    if (level >= 2 && kind !== "铲子") {
      const outer = this.add.circle(0, 0, isHero ? 38 : 37, rarityColor, level >= 4 ? 0.13 : 0.06).setStrokeStyle(level >= 4 ? 5 : 3, rarityColor, 0.96);
      container.add(outer);
      if (level >= 3) for (let index = 0; index < 4; index += 1) {
        const angle = Math.PI / 2 * index;
        container.add(this.add.circle(Math.cos(angle) * 38, Math.sin(angle) * 38, level >= 5 ? 4.5 : 3.2, rarityColor, 1));
      }
    }
    const disc = this.add.circle(0, 0, isHero ? 35 : 33,
      goldShovel && kind === "铲子" ? 0x9b6a22 : opponent ? 0x4d6b6b : isHero ? heroFill : isSoldier ? 0x52765b : 0x78634d, 1)
      .setStrokeStyle(isHero ? 4.5 : goldShovel && kind === "铲子" ? 5 : 3.5,
        isHero ? rarityColor : goldShovel && kind === "铲子" ? 0xffdc69 : 0xf7edcd, 1);
    container.add(disc);
    if (goldShovel && kind === "铲子") container.add(this.add.circle(0, 0, 28, 0xffd65a, 0.18));
    if (artKey) {
      const art = this.add.image(0, 2, artKey).setDisplaySize(isHero ? 70 : 66, isHero ? 70 : 66).setAlpha(0.96);
      if (goldShovel && kind === "铲子") art.setTint(0xffd36a);
      container.add(art);
    }
    const compactLabel = Boolean(artKey);
    if (compactLabel) container.add(this.add.circle(-24, -23, 17, opponent ? 0x38575a : 0x344c41, 0.98).setStrokeStyle(2.5, rarityColor, 0.95));
    const fontSize = compactLabel ? 24 : kind.length > 1 ? 29 : generalPart ? 45 : 43;
    const label = this.add.text(compactLabel ? -24 : 0, compactLabel ? -24 : -2, kind === "铲子" ? "铲" : kind, {
      fontFamily: '"STKaiti", "KaiTi", "Microsoft YaHei", serif', fontSize: `${fontSize}px`, color: "#fff8dc", fontStyle: "bold",
      stroke: compactLabel ? "#263b32" : "#2b312d", strokeThickness: compactLabel ? 3 : 2,
    }).setOrigin(0.5);
    if (goldShovel && kind === "铲子") label.setColor("#fff0a3").setStroke("#5d3510", 4);
    container.add(label);
    if (kind !== "铲子" && (isHero || isSoldier)) {
      const badge = this.add.circle(26, 25, 15, level >= 4 ? rarityColor : 0xb24738, 1).setStrokeStyle(2.5, 0xffefbc, 1);
      const levelText = this.add.text(26, 25, String(level), { fontFamily: '"Arial", sans-serif', fontSize: "18px", color: level >= 4 ? "#39291f" : "#ffffff", fontStyle: "bold" }).setOrigin(0.5);
      container.add([badge, levelText]);
    }
    container.setSize(78, 78);
    return container;
  }

  private enableInspect(container: Phaser.GameObjects.Container, kind: string, level: number, selection?: BattleInspectSelection) {
    container.setInteractive(
      new Phaser.Geom.Circle(container.width / 2, container.height / 2, BATTLE_INPUT.tokenHitRadius),
      Phaser.Geom.Circle.Contains,
    );
    if (container.input) container.input.cursor = "pointer";
    container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.beginPiecePointer(pointer, container, kind, level, selection);
    });
  }

  private enableDrag(
    container: Phaser.GameObjects.Container,
    sourceType: DragSource,
    sourceId: string,
    kind: string,
    level: number,
    partIndex?: 0 | 1,
    inspectKind = kind,
    inspectSelection?: BattleInspectSelection,
  ) {
    container.setData({ sourceType, sourceId, kind, partIndex });
    container.setInteractive(
      new Phaser.Geom.Circle(container.width / 2, container.height / 2, BATTLE_INPUT.tokenHitRadius),
      Phaser.Geom.Circle.Contains,
    );
    if (container.input) container.input.cursor = "grab";
    if (sourceType === "generalPart" && partIndex === undefined) {
      throw new Error("两格武将拖动缺少姓名字索引");
    }
    const drag = sourceType === "generalPart"
      ? { sourceType, id: sourceId, partIndex: partIndex as 0 | 1 } satisfies DragDescriptor
      : { sourceType, id: sourceId } satisfies DragDescriptor;
    container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.beginPiecePointer(pointer, container, inspectKind, level, inspectSelection, drag);
    });
  }

  private drawEnemies(player: PlayerBattleState, mirror: boolean) {
    if (!this.snapshot) return;
    for (const enemy of player.enemies) {
      const point = enemyPathPoint(this.snapshot.mapIndex, enemy);
      const y = mirror ? GAME_CONFIG.rows - 1 - point.y : point.y;
      const x = mirror ? GAME_CONFIG.columns - 1 - point.x : point.x;
      const seed = [...enemy.id].reduce((total, character) => total + character.charCodeAt(0), 0);
      const step = Math.sin((this.snapshot.tick + seed) * 0.34);
      const px = (x + 0.5) * CELL + Math.cos((this.snapshot.tick + seed) * 0.16) * 1.8;
      const py = MAP_TOP + (y + 0.5) * CELL + step * (enemy.boss ? 2.2 : 3.2);
      const regularKeys = [IMAGE_ASSETS.enemies.rebel.key, IMAGE_ASSETS.enemies.brute.key, IMAGE_ASSETS.enemies.scout.key, IMAGE_ASSETS.enemies.captain.key];
      const bossKeys = [IMAGE_ASSETS.enemies.bossHorned.key, IMAGE_ASSETS.enemies.bossBanner.key];
      const imageKey = enemy.boss ? bossKeys[seed % bossKeys.length]! : regularKeys[seed % regularKeys.length]!;
      const size = enemy.boss ? 74 : 53;
      const radius = enemy.boss ? 31 : 23;
      const shadow = this.add.ellipse(px, py + radius * 0.7, enemy.boss ? 54 : 34, enemy.boss ? 16 : 10, 0x1f302b, 0.4);
      const frame = this.add.circle(px, py, radius, enemy.boss ? 0x8f2f2d : mirror ? 0x475c66 : 0x5e3c35, 0.88)
        .setStrokeStyle(enemy.boss ? 3 : 2, enemy.boss ? 0xffd06e : 0xf0e5cf, 0.96);
      const body = this.pieceDisplayMode === "image"
        ? this.add.image(px, py + 1, imageKey).setDisplaySize(size, size)
        : this.add.text(px, py, enemy.boss ? "将" : "兵", {
            fontFamily: '"STKaiti", "KaiTi", serif', fontSize: enemy.boss ? "44px" : "31px",
            color: "#fff0c6", fontStyle: "bold", stroke: "#3b2522", strokeThickness: enemy.boss ? 5 : 3,
          }).setOrigin(0.5);
      body.setScale(enemy.scaleMultiplier ?? 1);
      body.setRotation(step * (enemy.boss ? 0.018 : 0.035));
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
        hint.lineStyle(5, 0xffd35c, 0.9).strokeRoundedRect(point.x * CELL + 5, MAP_TOP + point.y * CELL + 5, CELL - 10, CELL - 10, 7);
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
