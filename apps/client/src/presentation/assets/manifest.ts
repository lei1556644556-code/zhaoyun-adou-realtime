export type AssetLoadScope = "boot" | "lobby" | "battle" | "lazy";
export type AssetCategory = "background" | "tile" | "ui" | "troop" | "hero" | "enemy" | "key-art" | "effect" | "audio";

export interface RasterAssetSource {
  readonly kind: "raster";
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly alpha: boolean;
}

export interface PlannedAssetSource {
  readonly kind: "planned";
  readonly preferredFormat: "webp-atlas" | "ogg";
  readonly fallback: string;
}

export interface AssetEntry<
  Key extends string = string,
  Source extends RasterAssetSource | PlannedAssetSource = RasterAssetSource | PlannedAssetSource,
> {
  readonly key: Key;
  readonly category: AssetCategory;
  readonly scope: AssetLoadScope;
  readonly iconModeOnly?: boolean;
  readonly source: Source;
  readonly purpose: string;
}

const raster = <Key extends string>(
  key: Key,
  category: AssetCategory,
  scope: AssetLoadScope,
  path: string,
  width: number,
  height: number,
  bytes: number,
  alpha: boolean,
  purpose: string,
  iconModeOnly = false,
): AssetEntry<Key, RasterAssetSource> => ({ key, category, scope, iconModeOnly, source: { kind: "raster", path, width, height, bytes, alpha }, purpose });

const planned = <Key extends string>(
  key: Key,
  category: "effect" | "audio",
  preferredFormat: "webp-atlas" | "ogg",
  fallback: string,
  purpose: string,
): AssetEntry<Key, PlannedAssetSource> => ({ key, category, scope: "battle", source: { kind: "planned", preferredFormat, fallback }, purpose });

/**
 * Stable renderer-facing keys. Filenames may change in a later art pass without
 * changing consumers; rules and simulation must never import this manifest.
 */
export const ASSET_MANIFEST = {
  version: "1.0.0",
  assets: {
    "battle-bg": raster("battle-bg", "background", "battle", "assets/backgrounds/mountain-pass.webp", 1536, 1024, 378646, false, "Battlefield backdrop"),
    "lobby-key-art": raster("lobby-key-art", "background", "lobby", "assets/backgrounds/lobby-zhaoyun-adou.webp", 1024, 1536, 317690, false, "Lobby key art"),
    "key-art-zhao-yun": raster("key-art-zhao-yun", "key-art", "lazy", "assets/characters/zhao-yun.webp", 844, 900, 241170, true, "Large Zhao Yun promotional cutout"),
    "key-art-rebel-infantry": raster("key-art-rebel-infantry", "key-art", "lazy", "assets/characters/rebel-infantry.webp", 292, 320, 35354, true, "Large rebel infantry promotional cutout"),

    "tile-road": raster("tile-road", "tile", "battle", "assets/tiles/road.webp", 256, 256, 18110, false, "Marching road tile"),
    "tile-grass": raster("tile-grass", "tile", "battle", "assets/tiles/grass.webp", 256, 256, 14682, false, "Blocked grass tile"),
    "tile-deployment": raster("tile-deployment", "tile", "battle", "assets/tiles/deployment.webp", 256, 256, 8190, false, "Deployment tile"),
    "tile-paper": raster("tile-paper", "tile", "battle", "assets/tiles/paper.webp", 256, 256, 5920, false, "Reserve slot tile"),

    "ui-fort": raster("ui-fort", "ui", "battle", "assets/ui/fort.webp", 256, 256, 31166, true, "Fort marker"),
    "ui-adou": raster("ui-adou", "ui", "battle", "assets/ui/adou.webp", 256, 256, 25500, true, "A Dou objective marker"),
    "ui-camp": raster("ui-camp", "ui", "battle", "assets/ui/camp.webp", 256, 256, 31990, true, "Reserve camp marker"),
    "ui-bun": raster("ui-bun", "ui", "boot", "assets/ui/bun.webp", 256, 256, 25888, true, "Bun currency icon"),
    "ui-shovel": raster("ui-shovel", "ui", "battle", "assets/ui/shovel.webp", 256, 256, 18602, true, "Shovel prop icon"),
    "ui-shield": raster("ui-shield", "ui", "battle", "assets/ui/shield.webp", 256, 256, 26730, true, "Shield prop icon"),

    "troop-blade": raster("troop-blade", "troop", "battle", "assets/troops/blade.webp", 256, 256, 25846, true, "Blade troop portrait", true),
    "troop-bow": raster("troop-bow", "troop", "battle", "assets/troops/bow.webp", 256, 256, 35368, true, "Bow troop portrait", true),
    "troop-spear": raster("troop-spear", "troop", "battle", "assets/troops/spear.webp", 256, 256, 31306, true, "Spear troop portrait", true),
    "troop-cavalry": raster("troop-cavalry", "troop", "battle", "assets/troops/cavalry.webp", 256, 256, 33962, true, "Cavalry troop portrait", true),

    "hero-zhao-yun": raster("hero-zhao-yun", "hero", "battle", "assets/heroes/zhao-yun.webp", 256, 256, 34376, true, "Zhao Yun portrait", true),
    "hero-zhang-fei": raster("hero-zhang-fei", "hero", "battle", "assets/heroes/zhang-fei.webp", 256, 256, 33256, true, "Zhang Fei portrait", true),
    "hero-ma-chao": raster("hero-ma-chao", "hero", "battle", "assets/heroes/ma-chao.webp", 256, 256, 38052, true, "Ma Chao portrait", true),
    "hero-guan-yu": raster("hero-guan-yu", "hero", "battle", "assets/heroes/guan-yu.webp", 256, 256, 33758, true, "Guan Yu portrait", true),
    "hero-huang-zhong": raster("hero-huang-zhong", "hero", "battle", "assets/heroes/huang-zhong.webp", 256, 256, 35692, true, "Huang Zhong portrait", true),
    "hero-guan-ping": raster("hero-guan-ping", "hero", "battle", "assets/heroes/guan-ping.webp", 256, 256, 30084, true, "Guan Ping portrait", true),
    "hero-guan-xing": raster("hero-guan-xing", "hero", "battle", "assets/heroes/guan-xing.webp", 256, 256, 31420, true, "Guan Xing portrait", true),
    "hero-zhang-bao": raster("hero-zhang-bao", "hero", "battle", "assets/heroes/zhang-bao.webp", 256, 256, 33156, true, "Zhang Bao portrait", true),
    "hero-zhang-yi": raster("hero-zhang-yi", "hero", "battle", "assets/heroes/zhang-yi.webp", 256, 256, 29044, true, "Zhang Yi portrait", true),
    "hero-huang-gai": raster("hero-huang-gai", "hero", "battle", "assets/heroes/huang-gai.webp", 256, 256, 32976, true, "Huang Gai portrait", true),
    "hero-liu-bei": raster("hero-liu-bei", "hero", "battle", "assets/heroes/liu-bei.webp", 256, 256, 30360, true, "Liu Bei portrait", true),
    "hero-huang-zu": raster("hero-huang-zu", "hero", "battle", "assets/heroes/huang-zu.webp", 256, 256, 34182, true, "Huang Zu portrait", true),

    "enemy-rebel": raster("enemy-rebel", "enemy", "battle", "assets/enemies/rebel.webp", 256, 256, 17520, true, "Rebel enemy portrait"),
    "enemy-brute": raster("enemy-brute", "enemy", "battle", "assets/enemies/brute.webp", 256, 256, 18868, true, "Brute enemy portrait"),
    "enemy-scout": raster("enemy-scout", "enemy", "battle", "assets/enemies/scout.webp", 256, 256, 25408, true, "Scout enemy portrait"),
    "enemy-captain": raster("enemy-captain", "enemy", "battle", "assets/enemies/captain.webp", 256, 256, 22830, true, "Captain enemy portrait"),
    "enemy-boss-horned": raster("enemy-boss-horned", "enemy", "battle", "assets/enemies/boss-horned.webp", 256, 256, 27856, true, "Horned boss portrait"),
    "enemy-boss-banner": raster("enemy-boss-banner", "enemy", "battle", "assets/enemies/boss-banner.webp", 256, 256, 28418, true, "Banner boss portrait"),

    "fx-attack-slash": planned("fx-attack-slash", "effect", "webp-atlas", "procedural crescent stroke", "Blade action atlas"),
    "fx-attack-arrow": planned("fx-attack-arrow", "effect", "webp-atlas", "procedural arrow geometry", "Arrow projectile atlas"),
    "fx-attack-spear": planned("fx-attack-spear", "effect", "webp-atlas", "procedural spear streak", "Spear thrust atlas"),
    "fx-attack-charge": planned("fx-attack-charge", "effect", "webp-atlas", "procedural dust wedge", "Cavalry charge atlas"),
    "fx-impact-cut": planned("fx-impact-cut", "effect", "webp-atlas", "procedural arc and sparks", "Cut impact atlas"),
    "fx-impact-pierce": planned("fx-impact-pierce", "effect", "webp-atlas", "procedural ellipse flash", "Pierce impact atlas"),
    "fx-impact-burst": planned("fx-impact-burst", "effect", "webp-atlas", "procedural dust ring", "Charge impact atlas"),
    "fx-death-ash": planned("fx-death-ash", "effect", "webp-atlas", "fade, desaturate, three ash motes", "Ordinary death atlas"),
    "fx-death-banner": planned("fx-death-banner", "effect", "webp-atlas", "tilt and banner-fall silhouette", "Boss death atlas"),
    "fx-merge-ribbons": planned("fx-merge-ribbons", "effect", "webp-atlas", "two converging ink ribbons", "Merge feedback atlas"),
    "fx-upgrade-seal": planned("fx-upgrade-seal", "effect", "webp-atlas", "procedural rank seal and level pips", "Upgrade feedback atlas"),
    "sfx-attack": planned("sfx-attack", "audio", "ogg", "silent", "Shared short attack cue bank"),
    "sfx-impact": planned("sfx-impact", "audio", "ogg", "silent", "Shared impact cue bank"),
    "sfx-death": planned("sfx-death", "audio", "ogg", "silent", "Death cue"),
    "sfx-merge": planned("sfx-merge", "audio", "ogg", "silent", "Merge cue"),
    "sfx-upgrade": planned("sfx-upgrade", "audio", "ogg", "silent", "Upgrade cue"),
  },
} as const;

export type AssetKey = keyof typeof ASSET_MANIFEST.assets;
export type RasterAssetEntry = Extract<(typeof ASSET_MANIFEST.assets)[AssetKey], { source: { kind: "raster" } }>;

export const ASSET_TOTAL_RASTER_BYTES = Object.values(ASSET_MANIFEST.assets).reduce(
  (total, asset) => total + (asset.source.kind === "raster" ? asset.source.bytes : 0),
  0,
);

export function assetByKey(key: AssetKey): (typeof ASSET_MANIFEST.assets)[AssetKey] {
  return ASSET_MANIFEST.assets[key];
}

export function rasterAssetsFor(scope: AssetLoadScope, pieceMode: "text" | "icon" = "icon"): RasterAssetEntry[] {
  return Object.values(ASSET_MANIFEST.assets).filter((asset): asset is RasterAssetEntry => (
    asset.scope === scope && asset.source.kind === "raster" && (pieceMode === "icon" || !asset.iconModeOnly)
  ));
}
