import { combatProfileFor } from "./combatProfiles";
import type { BattleEvent, PresentationContext, PresentationCue, PresentationSink } from "./types";

export const PRESENTATION_BUDGETS = {
  desktop: { maxCuesPerBatch: 48, maxImpactsPerAttack: 8, particlesPerImpact: 8, seenEventLimit: 800 },
  mobile: { maxCuesPerBatch: 24, maxImpactsPerAttack: 4, particlesPerImpact: 4, seenEventLimit: 400 },
  reduced: { maxCuesPerBatch: 18, maxImpactsPerAttack: 3, particlesPerImpact: 0, seenEventLimit: 300 },
} as const;

function eventCues(event: BattleEvent, context: PresentationContext): PresentationCue[] {
  const budget = context.motion === "reduced" ? PRESENTATION_BUDGETS.reduced : PRESENTATION_BUDGETS[context.surface];
  const motionScale = context.motion === "reduced" ? 0.45 : 1;
  const cues: PresentationCue[] = [];

  if (event.type === "ATTACK_RESOLVED") {
    const profile = combatProfileFor(event.actor.kind);
    const impacts = event.impacts.slice(0, budget.maxImpactsPerAttack);
    cues.push({
      kind: "actor-motion", eventId: event.id, cueId: `${event.id}:actor`, actorId: event.actor.id, at: event.from,
      motion: profile.motion, profileId: profile.id, tint: event.special ? profile.accent : profile.primary,
      durationMs: Math.round(150 * motionScale), priority: event.special ? 70 : 30,
    });
    const primary = impacts[0];
    if (primary) {
      cues.push({
        kind: "projectile", eventId: event.id, cueId: `${event.id}:projectile`, from: event.from, to: primary.at,
        assetKey: profile.projectileAssetKey, profileId: profile.id, tint: event.special ? profile.accent : profile.primary,
        durationMs: Math.max(60, Math.round(profile.travelMs * motionScale)), priority: event.special ? 70 : 30,
      });
    }
    impacts.forEach((impact, index) => {
      cues.push({
        kind: "impact", eventId: event.id, cueId: `${event.id}:impact:${index}`, at: impact.at, targetId: impact.target.id,
        assetKey: profile.impactAssetKey, profileId: profile.id, particleCount: event.special ? budget.particlesPerImpact : Math.ceil(budget.particlesPerImpact / 2),
        tint: event.special ? profile.accent : profile.primary, durationMs: Math.round(300 * motionScale), priority: event.special ? 75 : 35,
      });
      if (impact.amountText) {
        cues.push({
          kind: "damage-label", eventId: event.id, cueId: `${event.id}:label:${index}`, at: impact.at, text: impact.amountText,
          emphasis: event.special ? "special" : "normal", durationMs: Math.round(520 * motionScale), priority: event.special ? 65 : 25,
        });
      }
    });
    if (context.audioEnabled) cues.push({
      kind: "audio", eventId: event.id, cueId: `${event.id}:audio`, assetKey: "sfx-attack", variant: profile.id,
      durationMs: 0, priority: event.special ? 60 : 15,
    });
  }

  if (event.type === "UNIT_MERGED") {
    cues.push({
      kind: "merge", eventId: event.id, cueId: `${event.id}:merge`, at: event.at, resultId: event.result.id,
      resultKind: event.result.kind, rarity: event.result.rarity, assetKey: "fx-merge-ribbons",
      durationMs: Math.round(460 * motionScale), priority: 95,
    }, {
      kind: "upgrade", eventId: event.id, cueId: `${event.id}:rank`, at: event.at, entityId: event.result.id,
      level: event.result.level, rarity: event.result.rarity, assetKey: "fx-upgrade-seal",
      durationMs: Math.round(620 * motionScale), priority: 96,
    });
    if (context.audioEnabled) cues.push({
      kind: "audio", eventId: event.id, cueId: `${event.id}:audio`, assetKey: "sfx-merge", variant: event.result.rarity,
      durationMs: 0, priority: 90,
    });
  }

  if (event.type === "UNIT_UPGRADED") {
    cues.push({
      kind: "upgrade", eventId: event.id, cueId: `${event.id}:upgrade`, at: event.at, entityId: event.entity.id,
      level: event.toLevel, rarity: event.entity.rarity, assetKey: "fx-upgrade-seal",
      durationMs: Math.round(620 * motionScale), priority: 96,
    });
    if (context.audioEnabled) cues.push({
      kind: "audio", eventId: event.id, cueId: `${event.id}:audio`, assetKey: "sfx-upgrade", variant: event.entity.rarity,
      durationMs: 0, priority: 90,
    });
  }

  if (event.type === "ENTITY_DIED") {
    const boss = event.entity.role === "boss";
    cues.push({
      kind: "death", eventId: event.id, cueId: `${event.id}:death`, at: event.at, entityId: event.entity.id,
      assetKey: boss ? "fx-death-banner" : "fx-death-ash", treatment: boss ? "banner-fall" : "ash",
      durationMs: Math.round((boss ? 760 : 380) * motionScale), priority: boss ? 100 : 85,
    });
    if (context.audioEnabled) cues.push({
      kind: "audio", eventId: event.id, cueId: `${event.id}:audio`, assetKey: "sfx-death", variant: boss ? "boss" : "ordinary",
      durationMs: 0, priority: boss ? 95 : 70,
    });
  }

  return cues;
}

/** Projects authoritative events only; it never diffs snapshots or infers outcomes. */
export function projectBattleEvent(event: BattleEvent, context: PresentationContext): readonly PresentationCue[] {
  return eventCues(event, context);
}

function fitCueBudget(cues: readonly PresentationCue[], limit: number): PresentationCue[] {
  if (cues.length <= limit) return [...cues];
  return cues
    .map((cue, index) => ({ cue, index }))
    .sort((left, right) => right.cue.priority - left.cue.priority || left.index - right.index)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map(({ cue }) => cue);
}

export interface ConsumptionStats {
  readonly receivedEvents: number;
  readonly duplicateEvents: number;
  readonly emittedCues: number;
  readonly droppedCues: number;
}

export class BattlePresentationController {
  private readonly seenEventIds = new Set<string>();
  private readonly sink: PresentationSink;

  constructor(sink: PresentationSink) {
    this.sink = sink;
  }

  consume(events: readonly BattleEvent[], context: PresentationContext): ConsumptionStats {
    const budget = context.motion === "reduced" ? PRESENTATION_BUDGETS.reduced : PRESENTATION_BUDGETS[context.surface];
    const batchIds = new Set<string>();
    const unseen = events.filter((event) => {
      if (this.seenEventIds.has(event.id) || batchIds.has(event.id)) return false;
      batchIds.add(event.id);
      return true;
    });
    for (const event of unseen) this.remember(event.id, budget.seenEventLimit);
    const projected = unseen.flatMap((event) => eventCues(event, context));
    const fitted = fitCueBudget(projected, budget.maxCuesPerBatch);
    if (fitted.length > 0) this.sink.enqueue(fitted);
    return {
      receivedEvents: events.length,
      duplicateEvents: events.length - unseen.length,
      emittedCues: fitted.length,
      droppedCues: projected.length - fitted.length,
    };
  }

  reset(): void {
    this.seenEventIds.clear();
  }

  private remember(id: string, limit: number): void {
    this.seenEventIds.add(id);
    while (this.seenEventIds.size > limit) {
      const oldest = this.seenEventIds.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.seenEventIds.delete(oldest);
    }
  }
}
