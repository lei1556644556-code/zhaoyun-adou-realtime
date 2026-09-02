export type ImageAsset = { readonly key: string; readonly path: string };

/** Stable gameplay-key -> renderer-asset mapping.
 * Gameplay data never depends on generated filenames or whether an image loaded.
 */
export const IMAGE_ASSETS = {
  battleBackground: { key: "battle-bg", path: "assets/backgrounds/mountain-pass.webp" },
  lobbyKeyArt: { key: "lobby-key-art", path: "assets/backgrounds/lobby-zhaoyun-adou.webp" },
  tiles: {
    road: { key: "tile-road", path: "assets/tiles/road.webp" },
    grass: { key: "tile-grass", path: "assets/tiles/grass.webp" },
    deployment: { key: "tile-deployment", path: "assets/tiles/deployment.webp" },
    paper: { key: "tile-paper", path: "assets/tiles/paper.webp" },
  },
  ui: {
    fort: { key: "ui-fort", path: "assets/ui/fort.webp" },
    adou: { key: "ui-adou", path: "assets/ui/adou.webp" },
    camp: { key: "ui-camp", path: "assets/ui/camp.webp" },
    bun: { key: "ui-bun", path: "assets/ui/bun.webp" },
    shovel: { key: "ui-shovel", path: "assets/ui/shovel.webp" },
    shield: { key: "ui-shield", path: "assets/ui/shield.webp" },
  },
  troops: {
    刀: { key: "troop-blade", path: "assets/troops/blade.webp" },
    弓: { key: "troop-bow", path: "assets/troops/bow.webp" },
    枪: { key: "troop-spear", path: "assets/troops/spear.webp" },
    骑: { key: "troop-cavalry", path: "assets/troops/cavalry.webp" },
  },
  heroes: {
    赵云: { key: "hero-zhao-yun", path: "assets/heroes/zhao-yun.webp" },
    张飞: { key: "hero-zhang-fei", path: "assets/heroes/zhang-fei.webp" },
    马超: { key: "hero-ma-chao", path: "assets/heroes/ma-chao.webp" },
    关羽: { key: "hero-guan-yu", path: "assets/heroes/guan-yu.webp" },
    黄忠: { key: "hero-huang-zhong", path: "assets/heroes/huang-zhong.webp" },
    关平: { key: "hero-guan-ping", path: "assets/heroes/guan-ping.webp" },
    关兴: { key: "hero-guan-xing", path: "assets/heroes/guan-xing.webp" },
    张苞: { key: "hero-zhang-bao", path: "assets/heroes/zhang-bao.webp" },
    张翼: { key: "hero-zhang-yi", path: "assets/heroes/zhang-yi.webp" },
    黄盖: { key: "hero-huang-gai", path: "assets/heroes/huang-gai.webp" },
    刘备: { key: "hero-liu-bei", path: "assets/heroes/liu-bei.webp" },
    黄祖: { key: "hero-huang-zu", path: "assets/heroes/huang-zu.webp" },
  },
  enemies: {
    rebel: { key: "enemy-rebel", path: "assets/enemies/rebel.webp" },
    brute: { key: "enemy-brute", path: "assets/enemies/brute.webp" },
    scout: { key: "enemy-scout", path: "assets/enemies/scout.webp" },
    captain: { key: "enemy-captain", path: "assets/enemies/captain.webp" },
    bossHorned: { key: "enemy-boss-horned", path: "assets/enemies/boss-horned.webp" },
    bossBanner: { key: "enemy-boss-banner", path: "assets/enemies/boss-banner.webp" },
  },
} as const;

export const HERO_ASSET_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IMAGE_ASSETS.heroes).map(([name, asset]) => [name, asset.key]),
);

export const TROOP_ASSET_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IMAGE_ASSETS.troops).map(([name, asset]) => [name, asset.key]),
);

function collectAssets(value: unknown, output: ImageAsset[]) {
  if (!value || typeof value !== "object") return;
  if ("key" in value && "path" in value) {
    output.push(value as ImageAsset);
    return;
  }
  Object.values(value).forEach((child) => collectAssets(child, output));
}

export function allImageAssets() {
  const output: ImageAsset[] = [];
  collectAssets(IMAGE_ASSETS, output);
  return output;
}
