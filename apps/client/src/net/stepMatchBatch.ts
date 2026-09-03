import { stepMatch, type CombatEffectEvent, type MatchSnapshot } from "@adou/shared";

/**
 * Advances every catch-up tick while retaining one-shot combat effects until
 * the caller publishes the final snapshot for this interval.
 */
export function stepMatchBatch(snapshot: MatchSnapshot, steps: number, deltaMs: number) {
  const combatEvents: CombatEffectEvent[] = [];
  snapshot.combatEvents = [];

  for (let index = 0; index < steps; index += 1) {
    stepMatch(snapshot, deltaMs);
    combatEvents.push(...snapshot.combatEvents);
    if (snapshot.phase === "finished") break;
  }

  snapshot.combatEvents = combatEvents;
  return snapshot;
}
