import type { AccountEconomy, OwnedProp } from "./SupabaseService";

export function shanghaiDayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function freshEconomy(gold = 0, stamina = 30, dayKey = shanghaiDayKey()): AccountEconomy {
  return {
    dayKey, gold,
    stamina: Math.max(0, Math.min(30, Math.floor(stamina))),
    winDay: 0, loseDay: 0, totalMatches: 0, ownedProps: [], completedMatchKeys: [],
  };
}

export function normalizeEconomy(value: unknown, dayKey = shanghaiDayKey()): AccountEconomy {
  const raw = value && typeof value === "object" ? value as Partial<AccountEconomy> : {};
  const gold = Math.max(0, Math.floor(Number(raw.gold) || 0));
  const stamina = Number.isFinite(Number(raw.stamina)) ? Math.floor(Number(raw.stamina)) : 30;
  const completedMatchKeys = (Array.isArray(raw.completedMatchKeys) ? raw.completedMatchKeys : [])
    .filter((key): key is string => typeof key === "string").slice(-50);
  const totalMatches = Math.max(
    completedMatchKeys.length,
    Math.max(0, Math.floor(Number(raw.totalMatches) || 0)),
  );
  if (raw.dayKey !== dayKey) {
    return { ...freshEconomy(gold, stamina, dayKey), totalMatches, completedMatchKeys };
  }
  const ownedProps = (Array.isArray(raw.ownedProps) ? raw.ownedProps : [])
    .filter((entry): entry is OwnedProp => Boolean(entry) && Number(entry.id) >= 2 && Number(entry.id) <= 24 && Number(entry.id) !== 23)
    .filter((entry, index, entries) => entries.findIndex((other) => Number(other.id) === Number(entry.id)) === index)
    .map((entry) => ({ id: Number(entry.id), level: Number(entry.id) === 22 ? Math.max(1, Math.min(3, Math.floor(Number(entry.level) || 1))) : 1 }));
  return {
    dayKey, gold, stamina: Math.max(0, Math.min(30, stamina)),
    winDay: Math.max(0, Math.floor(Number(raw.winDay) || 0)),
    loseDay: Math.max(0, Math.floor(Number(raw.loseDay) || 0)),
    totalMatches, ownedProps, completedMatchKeys,
    ...(raw.pendingResult ? { pendingResult: raw.pendingResult } : {}),
    ...(raw.pendingShop ? { pendingShop: raw.pendingShop } : {}),
  };
}
