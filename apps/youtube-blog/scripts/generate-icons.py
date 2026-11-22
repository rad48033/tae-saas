#!/usr/bin/env python3
"""taest 앱 아이콘 생성기.

디자이너가 고른 원본(`assets/brand/taest-icon.png`) 하나에서 웹(PWA)·데스크톱(Electron)·
안드로이드(Capacitor) 아이콘을 한 번에 뽑습니다. 원본은 어두운 배경 위에 둥근 사각형
아이콘이 놓인 1254x1254 RGB 이미지라서, 먼저 아이콘 사각형만 잘라낸 뒤 크기별로 다시 그립니다.

실행: python3 scripts/generate-icons.py    (Pillow 필요)
산출: public/icons/*.png, public/favicon.svg, public/favicon.ico, src/app/icon.png,
      apps/desktop/build/icon.png + icon.ico, apps/mobile/android/app/src/main/res/mipmap-*
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

APP_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = APP_DIR.parents[1]
SOURCE = REPO_DIR / "assets" / "brand" / "taest-icon.png"

# 원본에서 둥근 사각형이 차지하는 영역(측정값). 여백·그림자를 제외합니다.
ICON_BOX = (153, 145, 1099, 1091)
CORNER_RADIUS_RATIO = 0.22


def load_master() -> Image.Image:
    if not SOURCE.exists():
        raise SystemExit(f"원본 아이콘이 없습니다: {SOURCE}")
    image = Image.open(SOURCE).convert("RGB").crop(ICON_BOX)
    side = min(image.size)
    return image.resize((side, side), Image.LANCZOS)


def corner_color(image: Image.Image) -> tuple[int, int, int]:
    """아이콘 모서리의 어두운 배경색(투명 대신 채울 색)."""
    width, height = image.size
    samples = [
        image.getpixel((4, 4)),
        image.getpixel((width - 5, 4)),
        image.getpixel((4, height - 5)),
        image.getpixel((width - 5, height - 5)),
    ]
    return tuple(sum(channel) // len(samples) for channel in zip(*samples))  # type: ignore[return-value]


def rounded(size: int, radius_ratio: float = CORNER_RADIUS_RATIO) -> Image.Image:
    """둥근 모서리 + 투명 배경 아이콘."""
    master = load_master()
    image = master.resize((size, size), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * radius_ratio), fill=255
    )
    image.putalpha(mask.resize((size, size), Image.LANCZOS))
    return image


def circle(size: int) -> Image.Image:
    master = load_master()
    image = master.resize((size, size), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    image.putalpha(mask.resize((size, size), Image.LANCZOS))
    return image


def opaque(size: int, scale: float = 1.0) -> Image.Image:
    """투명도 없는 정사각 아이콘(iOS 홈 화면·스플래시용). scale<1이면 배경색 위에 줄여 놓습니다."""
    master = load_master()
    background = Image.new("RGBA", (size, size), corner_color(master) + (255,))
    inner = int(size * scale)
    art = master.resize((inner, inner), Image.LANCZOS).convert("RGBA")
    if scale < 1:
        mask = Image.new("L", (inner * 4, inner * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, inner * 4 - 1, inner * 4 - 1), radius=int(inner * 4 * CORNER_RADIUS_RATIO), fill=255
        )
        art.putalpha(mask.resize((inner, inner), Image.LANCZOS))
    offset = ((size - inner) // 2, (size - inner) // 2)
    background.alpha_composite(art, offset)
    return background


def foreground(size: int) -> Image.Image:
    """안드로이드 적응형 아이콘 앞면: 투명 배경 중앙에 마크."""
    master = load_master()
    art = master.resize((int(size * 0.68), int(size * 0.68)), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (art.size[0] * 4, art.size[1] * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, art.size[0] * 4 - 1, art.size[1] * 4 - 1),
        radius=int(art.size[0] * 4 * CORNER_RADIUS_RATIO),
        fill=255,
    )
    art.putalpha(mask.resize(art.size, Image.LANCZOS))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(art, ((size - art.size[0]) // 2, (size - art.size[1]) // 2))
    return canvas


def background(size: int) -> Image.Image:
    return Image.new("RGBA", (size, size), corner_color(load_master()) + (255,))


FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="taest">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b4bff"/>
      <stop offset="0.55" stop-color="#5b3bf0"/>
      <stop offset="1" stop-color="#8b1fd6"/>
    </linearGradient>
    <linearGradient id="mark" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#bfe7ff"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#bg)"/>
  <path d="M27 15 L50 32 L27 49 Z" fill="url(#mark)" stroke="url(#mark)"
        stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M21 23 C22 29 24.5 31 30 32 C24.5 33 22 35 21 41 C20 35 17.5 33 12 32 C17.5 31 20 29 21 23 Z"
        fill="url(#mark)"/>
</svg>
"""


def main() -> int:
    master = load_master()
    print(f"master {master.size[0]}x{master.size[1]} from {SOURCE.relative_to(REPO_DIR)}")

    targets: list[tuple[Path, Image.Image]] = []

    icon_dir = APP_DIR / "public" / "icons"
    icon_dir.mkdir(parents=True, exist_ok=True)
    targets += [
        (icon_dir / "icon-192.png", rounded(192)),
        (icon_dir / "icon-512.png", rounded(512)),
        (icon_dir / "icon-maskable-192.png", opaque(192)),
        (icon_dir / "icon-maskable-512.png", opaque(512)),
        (icon_dir / "icon-1024.png", opaque(1024)),
        (icon_dir / "apple-touch-icon.png", opaque(180)),
        (APP_DIR / "public" / "favicon-32.png", rounded(32, 0.28)),
        (APP_DIR / "src" / "app" / "icon.png", opaque(256)),
        (REPO_DIR / "apps" / "desktop" / "build" / "icon.png", opaque(512)),
    ]

    # 안드로이드 런처 아이콘: mdpi 48dp 기준 밀도 배수
    res = REPO_DIR / "apps" / "mobile" / "android" / "app" / "src" / "main" / "res"
    densities = {"ldpi": 36, "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for name, launcher in densities.items():
        folder = res / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        targets += [
            (folder / "ic_launcher.png", rounded(launcher)),
            (folder / "ic_launcher_round.png", circle(launcher)),
            (folder / "ic_launcher_foreground.png", foreground(launcher * 9 // 4)),
            (folder / "ic_launcher_background.png", background(launcher * 9 // 4)),
        ]

    for path, image in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix == ".png":
            image.save(path, "PNG", optimize=True)
        print(f"✔ {path.relative_to(REPO_DIR)}")

    # 파비콘(.ico): 여러 크기를 한 파일에 담습니다.
    ico_sizes = [(16, 16), (32, 32), (48, 48), (256, 256)]
    icons = [rounded(size[0], 0.28) for size in ico_sizes]
    ico_path = APP_DIR / "public" / "favicon.ico"
    icons[-1].save(ico_path, format="ICO", sizes=ico_sizes)
    print(f"✔ {ico_path.relative_to(REPO_DIR)}")

    desktop_ico = REPO_DIR / "apps" / "desktop" / "build" / "icon.ico"
    icons[-1].save(desktop_ico, format="ICO", sizes=ico_sizes)
    print(f"✔ {desktop_ico.relative_to(REPO_DIR)}")

    svg_path = APP_DIR / "public" / "favicon.svg"
    svg_path.write_text(FAVICON_SVG, "utf8")
    print(f"✔ {svg_path.relative_to(REPO_DIR)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
