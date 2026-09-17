import { combatProfileFor } from "./combatProfiles";

/** Presentation only. These values never participate in simulation or targeting. */
export function battleAttackStyle(kind: string) {
  const profile = combatProfileFor(kind);
  const variant = { cleave: "slash", loose: "arrow", thrust: "spear", charge: "charge" } as const;
  return {
    variant: variant[profile.motion],
    color: Number.parseInt(profile.primary.slice(1), 16),
    accent: Number.parseInt(profile.accent.slice(1), 16),
    duration: profile.travelMs,
  };
}

export function ultimateShape(kind: string, skillName: string) {
  if (skillName === "大喝") return "shockwave";
  const variant = battleAttackStyle(kind).variant;
  return variant === "arrow" ? "volley" : variant === "slash" ? "crescent" : variant === "charge" ? "charge" : "thrust";
}

/** Keep recent IDs across snapshot overlap; never clear the entire window mid-battle. */
export class EffectEventWindow {
  private readonly ids = new Set<string>();
  constructor(private readonly capacity = 2048) {}
  accept(id: string) {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.capacity) this.ids.delete(this.ids.values().next().value!);
    return true;
  }
  clear() { this.ids.clear(); }
}
