from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps" / "client" / "public" / "assets"


def convert(relative_source: str, relative_output: str, max_size: tuple[int, int], quality: int) -> None:
    source = ASSETS / relative_source
    output = ASSETS / relative_output
    with Image.open(source) as image:
        image.thumbnail(max_size, Image.Resampling.LANCZOS)
        mode = "RGBA" if "A" in image.getbands() else "RGB"
        image.convert(mode).save(output, "WEBP", quality=quality, method=6)
        print(f"{relative_output}: {image.width}x{image.height}, {output.stat().st_size} bytes")


JOBS = [
    ("backgrounds/mountain-pass.png", "backgrounds/mountain-pass.webp", (1536, 1024), 82),
    ("characters/zhao-yun.png", "characters/zhao-yun.webp", (900, 900), 88),
    ("characters/rebel-infantry.png", "characters/rebel-infantry.webp", (320, 320), 88),
    ("backgrounds/lobby-zhaoyun-adou.png", "backgrounds/lobby-zhaoyun-adou.webp", (1024, 1536), 86),
]

for job in JOBS:
    if (ASSETS / job[0]).exists():
        convert(*job)
