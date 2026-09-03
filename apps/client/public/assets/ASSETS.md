# Art asset inventory

The machine-readable, stable-key manifest is
`apps/client/src/presentation/assets/manifest.ts` (`AssetManifest` v1.0.0).
This file records provenance and production status; runtime code must use manifest
keys instead of deriving a key from a filename.

## Current inventory and budget

| Group | Files | Canvas | Bytes | Load policy |
|---|---:|---|---:|---|
| backgrounds | 2 | 1024×1536 / 1536×1024 | 696,336 | lobby or battle |
| large character key art | 2 | 292×320 / 844×900 | 276,524 | lazy only |
| troop portraits | 4 | 256×256 alpha | 126,482 | battle, icon mode only |
| hero portraits | 12 | 256×256 alpha | 396,356 | battle, icon mode only |
| enemy portraits | 6 | 256×256 alpha | 140,900 | battle |
| tiles | 4 | 256×256 | 46,902 | battle |
| UI icons | 6 | 256×256 alpha | 159,876 | boot or battle |
| **Total** | **36** |  | **1,843,376 (1.76 MiB)** |  |

The text piece mode skips all 16 troop/hero portraits (522,838 bytes). The icon
mode uses the same full-size 256×256 sources at a 62 px mobile or 76 px desktop
display target so the portraits remain clear without enlarging during attacks.

## Stable visual language

- Common / purple / gold ranks use a quiet frame, one-character rank seal and an
  exact `Lv.n` label. Level pips are capped at five only as a compact secondary
  indicator; the label remains authoritative for display.
- Attacks never scale the portrait. Each of the four troop classes has a distinct
  motion silhouette (cleave, loose, thrust, charge), and all 12 heroes add an
  identity-specific palette and trail signature.
- Merge is two converging ink ribbons plus a result seal; upgrade is a local rank
  seal pulse. Ordinary death fades to ash; boss death uses a falling-banner
  silhouette. These effects stay anchored to the unit/path position instead of
  covering the middle of the board.

## Pending production assets

The following stable keys are reserved but currently use the manifest fallback:

- 11 compact WebP-atlas effects: four attacks, three impacts, two deaths, merge,
  and upgrade. Current fallback is procedural Phaser geometry.
- Five short OGG cue banks: attack, impact, death, merge, and upgrade. Current
  fallback is silence.

Target atlas budget is at most two 1024×1024 pages and 700 KiB compressed total.
Target audio budget is 350 KiB compressed total, with no clip longer than 1.2 s.
The material direction is late-Han ink, mineral pigment, bronze and battlefield
flags; avoid modern glow, large opaque explosions and gore.

These raster assets were generated specifically for this project. They are original production candidates, not extracted from the reference game. Full-resolution PNG sources and reproducible prompt notes are versioned under `art_sources/`.

## `backgrounds/lobby-zhaoyun-adou.webp`

- Intended use: responsive lobby key art.
- Direction: original Three Kingdoms cavalry general protecting a bundled infant, Chinese ink-wash and mineral-pigment illustration, jade/parchment/cinnabar palette.
- Constraints used: historically inspired original design, no copied game design, no text, no logo, no watermark, no gore, no modern objects.

## `backgrounds/mountain-pass.webp`

- Intended use: responsive battle background.
- Direction: elevated Three Kingdoms mountain pass, readable S-road, ink-wash plus woodblock texture, indigo/jade/parchment/cinnabar palette.
- Constraints used: environment only, no characters, no text, no logos, no watermark, no modern objects.

## `characters/zhao-yun.webp`

- Intended use: hero token and lobby key art.
- Direction: original chibi cavalry hero archetype, silver lamellar armor, white scarf, indigo/jade accents, spear, transparent background.
- Constraints used: one character, no scenery, no text, no logos, no watermark, no copied film/game costume.

## `characters/rebel-infantry.webp`

- Intended use: ordinary enemy sprite on the marching road.
- Direction: original late-Han rebel infantry, ochre headwrap, weathered lamellar vest, short spear, compact readable silhouette.
- Constraints used: transparent background, one character, no gore, no scenery, no text, no logos, no watermark, no copied film/game costume.

## Production battle set

- `tiles/`: road, blocked grass, deployment stone, and rice-paper reserve textures.
- `ui/`: fort, A Dou cradle, camp, bun, shovel, and shield icons.
- `troops/`: blade, bow, spear, and cavalry class portraits.
- `heroes/`: the complete 12-general portrait roster used by the 1.0.9 ruleset.
- `enemies/`: four marching-enemy silhouettes and two boss silhouettes.

The transparent portraits use a shared 256×256 canvas, centered horizontally and bottom-anchored so token placement remains stable on desktop and mobile. Tile assets also use 256×256 squares to avoid runtime crop differences.

Before commercial release, run the studio's normal legal and art-direction review and replace any candidate that does not meet the final brand standard.

Runtime WebP files are optimized derivatives generated by `tools/build_art_assets.py`. See `art_sources/PROMPTS.md` for the source-to-runtime contract and prompt set.
