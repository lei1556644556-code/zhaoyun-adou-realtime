import type { AssetKey } from "./assets/manifest";

export interface CombatProfile {
  readonly id: string;
  readonly motion: "cleave" | "loose" | "thrust" | "charge";
  readonly projectileAssetKey: AssetKey;
  readonly impactAssetKey: AssetKey;
  readonly primary: string;
  readonly accent: string;
  readonly travelMs: number;
  readonly signature: string;
}

const profile = (
  id: string,
  motion: CombatProfile["motion"],
  projectileAssetKey: AssetKey,
  impactAssetKey: AssetKey,
  primary: string,
  accent: string,
  travelMs: number,
  signature: string,
): CombatProfile => ({ id, motion, projectileAssetKey, impactAssetKey, primary, accent, travelMs, signature });

const BLADE = ["fx-attack-slash", "fx-impact-cut"] as const;
const BOW = ["fx-attack-arrow", "fx-impact-pierce"] as const;
const SPEAR = ["fx-attack-spear", "fx-impact-pierce"] as const;
const CHARGE = ["fx-attack-charge", "fx-impact-burst"] as const;

/** Art direction only: identities, palettes and motion grammar; no combat values. */
export const COMBAT_PROFILES: Readonly<Record<string, CombatProfile>> = {
  "刀": profile("troop.blade-cleave", "cleave", ...BLADE, "#a93632", "#ffe3a2", 130, "single cinnabar crescent"),
  "弓": profile("troop.bow-shot", "loose", ...BOW, "#bc712d", "#fff0b0", 220, "ochre arrow with pale fletching"),
  "枪": profile("troop.spear-thrust", "thrust", ...SPEAR, "#397d91", "#d9fbff", 175, "indigo straight-line thrust"),
  "骑": profile("troop.cavalry-charge", "charge", ...CHARGE, "#a64a36", "#ffc66f", 155, "low dust wedge"),

  "赵云": profile("hero.zhao-yun.silver-dash", "thrust", ...SPEAR, "#327b91", "#eefcff", 155, "silver-blue double afterline"),
  "张飞": profile("hero.zhang-fei.thunder-thrust", "thrust", ...SPEAR, "#42375f", "#d5bdff", 185, "violet broken shock ring"),
  "马超": profile("hero.ma-chao.white-rider", "charge", ...CHARGE, "#c7d4d6", "#fff1a6", 140, "white-gold hoof streak"),
  "关羽": profile("hero.guan-yu.crescent-cleave", "cleave", ...BLADE, "#327054", "#f1d887", 145, "jade crescent with long tail"),
  "黄忠": profile("hero.huang-zhong.ember-arrow", "loose", ...BOW, "#b64a2e", "#ffd279", 205, "ember arrow and short spark wake"),
  "关平": profile("hero.guan-ping.guard-cleave", "cleave", ...BLADE, "#5f7851", "#dbe5a0", 145, "compact square-ended arc"),
  "关兴": profile("hero.guan-xing.swift-cleave", "cleave", ...BLADE, "#467e68", "#bff1d7", 120, "paired narrow crescents"),
  "张苞": profile("hero.zhang-bao.black-spear", "thrust", ...SPEAR, "#533e50", "#efb9cb", 165, "dark spear line with rose tip"),
  "张翼": profile("hero.zhang-yi.winged-charge", "charge", ...CHARGE, "#5f6c8e", "#dce5ff", 150, "two lateral wing strokes"),
  "黄盖": profile("hero.huang-gai.bronze-charge", "charge", ...CHARGE, "#8a5b32", "#f1cd78", 165, "heavy bronze dust block"),
  "刘备": profile("hero.liu-bei.twin-wave", "cleave", ...BLADE, "#73612c", "#fff0a0", 155, "crossed gold-green sword waves"),
  "黄祖": profile("hero.huang-zu.river-volley", "loose", ...BOW, "#376c78", "#bfe7de", 225, "teal three-line arrow wake"),
};

export const FALLBACK_COMBAT_PROFILE = COMBAT_PROFILES["刀"]!;

export function combatProfileFor(kind: string): CombatProfile {
  return COMBAT_PROFILES[kind] ?? FALLBACK_COMBAT_PROFILE;
}
