import type { PlayerSlot } from "@adou/shared";
import type { AssetKey } from "./assets/manifest";

export type PresentationSurface = "mobile" | "desktop";
export type MotionPreference = "full" | "reduced";
export type PieceRarity = "common" | "purple" | "gold";

export type BattleAnchor =
  | { readonly kind: "cell"; readonly cell: number; readonly secondaryCell?: number }
  | { readonly kind: "path"; readonly progress: number }
  | { readonly kind: "entity"; readonly entityId: string }
  | { readonly kind: "screen"; readonly x: number; readonly y: number };

export interface BattleEntityRef {
  readonly id: string;
  readonly kind: string;
  readonly role: "troop" | "hero" | "enemy" | "boss" | "prop";
}

interface BattleEventBase {
  /** Globally stable within a room; renderers deduplicate on this field. */
  readonly id: string;
  readonly roomId: string;
  readonly tick: number;
  readonly slot: PlayerSlot;
}

export interface AttackBattleEvent extends BattleEventBase {
  readonly type: "ATTACK_RESOLVED";
  readonly actor: BattleEntityRef;
  readonly from: BattleAnchor;
  readonly impacts: readonly {
    readonly target: BattleEntityRef;
    readonly at: BattleAnchor;
    /** Already formatted by the event provider; the presentation layer never calculates damage. */
    readonly amountText?: string;
  }[];
  readonly special: boolean;
}

export interface MergeBattleEvent extends BattleEventBase {
  readonly type: "UNIT_MERGED";
  readonly sources: readonly [BattleEntityRef, BattleEntityRef];
  readonly result: BattleEntityRef & { readonly level: number; readonly rarity: PieceRarity };
  readonly at: BattleAnchor;
}

export interface UpgradeBattleEvent extends BattleEventBase {
  readonly type: "UNIT_UPGRADED";
  readonly entity: BattleEntityRef & { readonly rarity: PieceRarity };
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly at: BattleAnchor;
}

export interface DeathBattleEvent extends BattleEventBase {
  readonly type: "ENTITY_DIED";
  readonly entity: BattleEntityRef;
  readonly at: BattleAnchor;
}

/**
 * Presentation-side structural view of docs/contracts/battle-presentation.md.
 * The shared battle package remains the authoritative provider after integration.
 */
export type BattleEvent = AttackBattleEvent | MergeBattleEvent | UpgradeBattleEvent | DeathBattleEvent;

interface CueBase {
  readonly eventId: string;
  readonly cueId: string;
  readonly durationMs: number;
  readonly priority: number;
}

export type PresentationCue =
  | (CueBase & {
    readonly kind: "actor-motion";
    readonly actorId: string;
    readonly at: BattleAnchor;
    readonly motion: "cleave" | "loose" | "thrust" | "charge";
    readonly profileId: string;
    readonly tint: string;
  })
  | (CueBase & {
    readonly kind: "projectile";
    readonly from: BattleAnchor;
    readonly to: BattleAnchor;
    readonly assetKey: AssetKey;
    readonly profileId: string;
    readonly tint: string;
  })
  | (CueBase & {
    readonly kind: "impact";
    readonly at: BattleAnchor;
    readonly targetId: string;
    readonly assetKey: AssetKey;
    readonly profileId: string;
    readonly particleCount: number;
    readonly tint: string;
  })
  | (CueBase & {
    readonly kind: "damage-label";
    readonly at: BattleAnchor;
    readonly text: string;
    readonly emphasis: "normal" | "special";
  })
  | (CueBase & {
    readonly kind: "death";
    readonly at: BattleAnchor;
    readonly entityId: string;
    readonly assetKey: AssetKey;
    readonly treatment: "ash" | "banner-fall";
  })
  | (CueBase & {
    readonly kind: "merge";
    readonly at: BattleAnchor;
    readonly resultId: string;
    readonly resultKind: string;
    readonly rarity: PieceRarity;
    readonly assetKey: AssetKey;
  })
  | (CueBase & {
    readonly kind: "upgrade";
    readonly at: BattleAnchor;
    readonly entityId: string;
    readonly level: number;
    readonly rarity: PieceRarity;
    readonly assetKey: AssetKey;
  })
  | (CueBase & {
    readonly kind: "audio";
    readonly assetKey: AssetKey;
    readonly variant: string;
  });

export interface PresentationContext {
  readonly surface: PresentationSurface;
  readonly motion: MotionPreference;
  readonly audioEnabled: boolean;
}

export interface PresentationSink {
  enqueue(cues: readonly PresentationCue[]): void;
}
