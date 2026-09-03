import type { AssetKey } from "./assets/manifest";
import type { PieceRarity, PresentationSurface } from "./types";

export type PieceDisplayMode = "text" | "icon";

export const PIECE_ICON_KEYS: Readonly<Record<string, AssetKey>> = {
  "刀": "troop-blade",
  "弓": "troop-bow",
  "枪": "troop-spear",
  "骑": "troop-cavalry",
  "赵云": "hero-zhao-yun",
  "张飞": "hero-zhang-fei",
  "马超": "hero-ma-chao",
  "关羽": "hero-guan-yu",
  "黄忠": "hero-huang-zhong",
  "关平": "hero-guan-ping",
  "关兴": "hero-guan-xing",
  "张苞": "hero-zhang-bao",
  "张翼": "hero-zhang-yi",
  "黄盖": "hero-huang-gai",
  "刘备": "hero-liu-bei",
  "黄祖": "hero-huang-zu",
};

const RARITY_TOKENS = {
  common: { frame: "#6f775f", fill: "#ece3ca", label: "军" },
  purple: { frame: "#8f6bb3", fill: "#342c40", label: "良" },
  gold: { frame: "#d7b86e", fill: "#3b3025", label: "神" },
} as const;

export interface PieceVisualRequest {
  readonly kind: string;
  readonly label?: string;
  readonly level: number;
  readonly rarity: PieceRarity;
  readonly mode: PieceDisplayMode;
  readonly surface: PresentationSurface;
}

export interface PieceVisual {
  readonly mode: PieceDisplayMode;
  readonly label: string;
  readonly accessibleLabel: string;
  readonly iconAssetKey?: AssetKey;
  readonly iconSize: number;
  readonly frameSize: number;
  readonly frameColor: string;
  readonly frameFill: string;
  readonly rarityMark: string;
  readonly levelLabel: string;
  /** Capped visual ticks; levelLabel always preserves the exact level. */
  readonly levelPips: number;
}

/** Pure view-model resolver; no gameplay config or rule values are read here. */
export function resolvePieceVisual(request: PieceVisualRequest): PieceVisual {
  const level = Math.max(0, Math.floor(request.level));
  const token = RARITY_TOKENS[request.rarity];
  const iconAssetKey = request.mode === "icon" ? PIECE_ICON_KEYS[request.kind] : undefined;
  const compact = request.surface === "mobile";
  return {
    mode: iconAssetKey ? "icon" : "text",
    label: request.label ?? request.kind,
    accessibleLabel: `${request.kind}，${token.label}品，等级 ${level}`,
    iconAssetKey,
    iconSize: request.mode === "icon" ? (compact ? 62 : 76) : 0,
    frameSize: request.mode === "icon" ? (compact ? 70 : 86) : (compact ? 46 : 54),
    frameColor: token.frame,
    frameFill: token.fill,
    rarityMark: token.label,
    levelLabel: `Lv.${level}`,
    levelPips: Math.min(level, 5),
  };
}
