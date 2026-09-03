import {
  GAME_CONFIG, HERO_PAIRS, applyCommand, cellCode, cellCoords, cloneSnapshot, createMatch, stepMatch,
  type GameCommand, type MatchSnapshot, type PlayerBattleState, type UnitState,
} from "@adou/shared";

export class PracticeEngine extends EventTarget {
  snapshot: MatchSnapshot;
  private timer = 0;
  private botTimer = 0;

  constructor(saved?: MatchSnapshot, seed = Math.floor(Math.random() * 0xFFFFFFFF), introRound = 10) {
    super();
    this.snapshot = saved ? cloneSnapshot(saved) : createMatch("演武场", seed, 0, [introRound, introRound]);
  }

  start() {
    if (this.timer) return;
    this.emit();
    this.timer = window.setInterval(() => {
      stepMatch(this.snapshot, 1000 / GAME_CONFIG.tickHz);
      this.botTimer += 1000 / GAME_CONFIG.tickHz;
      if (this.botTimer >= 550) { this.botTimer = 0; this.botMove(); }
      this.emit();
    }, 1000 / GAME_CONFIG.tickHz);
  }

  send(command: GameCommand) {
    const result = applyCommand(this.snapshot, 0, command);
    if (!result.ok) this.dispatchEvent(new CustomEvent("notice", { detail: { message: result.message } }));
    this.emit();
  }

  private botMove() {
    const bot = this.snapshot.players[1];
    const reserve = bot.reserve[0];
    if (reserve) {
      const target = chooseReserveTarget(this.snapshot.mapIndex, bot, reserve.kind);
      if (target !== null) applyCommand(this.snapshot, 1, { type: "DROP_RESERVE", reserveId: reserve.id, targetCell: target });
      return;
    }
    const merge = findMerge(bot.units);
    if (merge) {
      applyCommand(this.snapshot, 1, { type: "MERGE", sourceId: merge[0].id, targetId: merge[1].id });
      return;
    }
    if (bot.buns >= bot.recruitCost) applyCommand(this.snapshot, 1, { type: "RECRUIT" });
  }

  private emit() {
    this.dispatchEvent(new CustomEvent("snapshot", { detail: cloneSnapshot(this.snapshot) }));
  }

  stop() { window.clearInterval(this.timer); this.timer = 0; }
}

export function findMerge(units: UnitState[]): [UnitState, UnitState] | null {
  for (let i = 0; i < units.length; i += 1) for (let j = i + 1; j < units.length; j += 1) {
    const a = units[i]; const b = units[j];
    if (!a || !b) continue;
    if ((a.kind === b.kind && a.level === b.level) || Boolean(HERO_PAIRS[`${a.kind}+${b.kind}`])) return [a, b];
  }
  return null;
}

function chooseReserveTarget(mapIndex: number, player: PlayerBattleState, kind: string) {
  if (kind === "铲子") {
    for (let cell = 0; cell < GAME_CONFIG.columns * GAME_CONFIG.rows; cell += 1) {
      if (cellCode(mapIndex, cell) !== "2_0" || player.unlockedCells.includes(cell)) continue;
      return cell;
    }
    return null;
  }
  const mergeTarget = player.units.find((unit) =>
    (unit.kind === kind && unit.level === 1) || Boolean(HERO_PAIRS[`${kind}+${unit.kind}`]),
  );
  if (mergeTarget) return mergeTarget.cell;
  return player.unlockedCells.find((cell) => !player.units.some((unit) => unit.cell === cell || unit.secondaryCell === cell)) ?? null;
}
