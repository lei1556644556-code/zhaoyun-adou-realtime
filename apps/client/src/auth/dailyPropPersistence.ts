import type { PropLoadout } from "@adou/shared";
import type { OwnedProp } from "./SupabaseService";

export interface DailyPropCache {
  version: 1;
  dayKey: string;
  updatedAt: number;
  ownedProps: OwnedProp[];
  propLoadout: PropLoadout;
}

export function normalizeOwnedProps(value: unknown): OwnedProp[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is OwnedProp => Boolean(entry) && Number(entry.id) >= 2 && Number(entry.id) <= 24 && Number(entry.id) !== 23)
    .filter((entry, index, entries) => entries.findIndex((other) => Number(other.id) === Number(entry.id)) === index)
    .map((entry) => ({
      id: Number(entry.id),
      level: Number(entry.id) === 22 ? Math.max(1, Math.min(3, Math.floor(Number(entry.level) || 1))) : 1,
    }))
    .sort((left, right) => left.id - right.id);
}

export function mergeOwnedProps(remote: OwnedProp[], cached: OwnedProp[]) {
  const levels = new Map<number, number>();
  for (const entry of [...normalizeOwnedProps(remote), ...normalizeOwnedProps(cached)]) {
    levels.set(entry.id, Math.max(levels.get(entry.id) ?? 0, entry.level));
  }
  return [...levels].map(([id, level]) => ({ id, level })).sort((left, right) => left.id - right.id);
}

export function parseDailyPropCache(serialized: string | null, currentDayKey: string): DailyPropCache | null {
  try {
    const raw = JSON.parse(serialized ?? "null") as Partial<DailyPropCache> | null;
    if (!raw || raw.version !== 1 || raw.dayKey !== currentDayKey || !Number.isFinite(raw.updatedAt)) return null;
    return {
      version: 1,
      dayKey: currentDayKey,
      updatedAt: Number(raw.updatedAt),
      ownedProps: normalizeOwnedProps(raw.ownedProps),
      propLoadout: raw.propLoadout && typeof raw.propLoadout === "object"
        ? raw.propLoadout as PropLoadout
        : { active: [], passive: [] },
    };
  } catch { return null; }
}

export function sameOwnedProps(left: OwnedProp[], right: OwnedProp[]) {
  return JSON.stringify(normalizeOwnedProps(left)) === JSON.stringify(normalizeOwnedProps(right));
}
