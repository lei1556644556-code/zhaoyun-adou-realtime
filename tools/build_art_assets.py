"""Slice the approved generated atlases into normalized browser-game assets.

The full-resolution source atlases stay under art_sources/ for art review. Runtime
derivatives are deliberately small WebP files with stable names so the renderer
never depends on generated filenames.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art_sources" / "atlases"
OUTPUT = ROOT / "apps" / "client" / "public" / "assets"


def save_tile(source: Path, box: tuple[int, int, int, int], target: Path) -> None:
    with Image.open(source) as image:
        tile = image.convert("RGB").crop(box).resize((256, 256), Image.Resampling.LANCZOS)
    target.parent.mkdir(parents=True, exist_ok=True)
    tile.save(target, "WEBP", quality=88, method=6)


def save_sprite(
    source: Path,
    box: tuple[int, int, int, int],
    target: Path,
    *,
    canvas_size: int = 256,
    padding: int = 10,
) -> None:
    with Image.open(source) as image:
        sprite = image.convert("RGBA").crop(box)
    alpha_box = sprite.getchannel("A").getbbox()
    if alpha_box:
        sprite = sprite.crop(alpha_box)
    scale = min((canvas_size - padding * 2) / sprite.width, (canvas_size - padding * 2) / sprite.height)
    sprite = sprite.resize(
        (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    x = (canvas_size - sprite.width) // 2
    y = canvas_size - padding - sprite.height
    canvas.alpha_composite(sprite, (x, y))
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target, "WEBP", quality=90, method=6, lossless=False)


def grid_box(column: int, row: int, cell_width: int, cell_height: int) -> tuple[int, int, int, int]:
    return (
        column * cell_width,
        row * cell_height,
        (column + 1) * cell_width,
        (row + 1) * cell_height,
    )


def main() -> None:
    image2_key_art = ROOT / "art_sources" / "key-art" / "lobby-image2.png"
    if image2_key_art.exists():
        with Image.open(image2_key_art) as image:
            key_art = image.convert("RGB")
            if key_art.width > 1024:
                key_art = key_art.resize((1024, round(key_art.height * 1024 / key_art.width)), Image.Resampling.LANCZOS)
        key_art.save(OUTPUT / "backgrounds" / "lobby-zhaoyun-adou.webp", "WEBP", quality=88, method=6)

    tile_source = SOURCE / "battle-tiles.png"
    tile_names = (("road", 0, 0), ("grass", 1, 0), ("deployment", 0, 1), ("paper", 1, 1))
    for name, column, row in tile_names:
        save_tile(tile_source, grid_box(column, row, 627, 627), OUTPUT / "tiles" / f"{name}.webp")

    structure_source = SOURCE / "structures-and-economy.png"
    structure_names = (
        ("fort", 0, 0), ("adou", 1, 0), ("camp", 2, 0),
        ("bun", 0, 1), ("shovel", 1, 1), ("shield", 2, 1),
    )
    for name, column, row in structure_names:
        save_sprite(structure_source, grid_box(column, row, 512, 512), OUTPUT / "ui" / f"{name}.webp")

    troop_source = SOURCE / "troop-portraits.png"
    troop_rows = ((0, 642), (642, 1285))
    troop_names = (("blade", 0, 0), ("bow", 1, 0), ("spear", 0, 1), ("cavalry", 1, 1))
    for name, column, row in troop_names:
        top, bottom = troop_rows[row]
        save_sprite(troop_source, (column * 612, top, (column + 1) * 612, bottom), OUTPUT / "troops" / f"{name}.webp")

    hero_source = SOURCE / "hero-portraits.png"
    hero_names = (
        ("zhao-yun", 0, 0), ("zhang-fei", 1, 0), ("ma-chao", 2, 0), ("guan-yu", 3, 0),
        ("huang-zhong", 0, 1), ("guan-ping", 1, 1), ("guan-xing", 2, 1), ("zhang-bao", 3, 1),
        ("zhang-yi", 0, 2), ("huang-gai", 1, 2), ("liu-bei", 2, 2), ("huang-zu", 3, 2),
    )
    for name, column, row in hero_names:
        save_sprite(hero_source, grid_box(column, row, 362, 362), OUTPUT / "heroes" / f"{name}.webp")

    enemy_source = SOURCE / "enemy-roster.png"
    enemy_names = (
        ("rebel", 0, 0), ("brute", 1, 0), ("scout", 2, 0),
        ("captain", 0, 1), ("boss-horned", 1, 1), ("boss-banner", 2, 1),
    )
    for name, column, row in enemy_names:
        save_sprite(enemy_source, grid_box(column, row, 512, 512), OUTPUT / "enemies" / f"{name}.webp")

    preview_files = [
        *(OUTPUT / "tiles").glob("*.webp"),
        *(OUTPUT / "ui").glob("*.webp"),
        *(OUTPUT / "troops").glob("*.webp"),
        *(OUTPUT / "heroes").glob("*.webp"),
        *(OUTPUT / "enemies").glob("*.webp"),
    ]
    thumb_size = 144
    label_height = 24
    columns = 6
    rows = (len(preview_files) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * thumb_size, rows * (thumb_size + label_height)), "#e7dfc9")
    draw = ImageDraw.Draw(sheet)
    for index, path in enumerate(preview_files):
        with Image.open(path) as image:
            thumb = image.convert("RGBA").resize((thumb_size, thumb_size), Image.Resampling.LANCZOS)
        column, row = index % columns, index // columns
        x, y = column * thumb_size, row * (thumb_size + label_height)
        checker = Image.new("RGBA", (thumb_size, thumb_size), "#f5f0df")
        checker.alpha_composite(thumb)
        sheet.paste(checker.convert("RGB"), (x, y))
        draw.text((x + 6, y + thumb_size + 5), path.stem, fill="#304b40")
    preview = ROOT / "art_sources" / "previews" / "runtime-contact-sheet.png"
    preview.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(preview, "PNG", optimize=True)


if __name__ == "__main__":
    main()
