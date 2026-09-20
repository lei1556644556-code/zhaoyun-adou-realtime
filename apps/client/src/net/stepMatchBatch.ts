import { stepMatch, type BattleEvent, type MatchSnapshot } from "@adou/shared";

/**
 * Advances every catch-up tick while retaining one-shot combat effects until
 * the caller publishes the final snapshot for this interval.
 */
export function stepMatchBatch(snapshot: MatchSnapshot, steps: number, deltaMs: number) {
  const events: BattleEvent[] = [];

  for (let index = 0; index < steps; index += 1) {
    stepMatch(snapshot, deltaMs);
    events.push(...snapshot.events);
    if (snapshot.phase === "finished") break;
  }

  snapshot.events = events;
  snapshot.combatEvents = events.filter(event => event.type === "attack");
  return snapshot;
}
