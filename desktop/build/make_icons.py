#!/usr/bin/env python3
"""Generate the app .icns and the menu-bar (tray) template PNGs.

No external assets required: everything is drawn with Pillow.
"""
import os
import subprocess
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ICONSET = os.path.join(HERE, "icon.iconset")

TEAL = (13, 148, 136, 255)      # brand color (#0d9488)
TEAL_DK = (6, 95, 87, 255)


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_check(draw, size, color, width_ratio=0.11):
    """A bold check mark centered in a size*size canvas."""
    w = max(2, int(size * width_ratio))
    # points roughly forming a check
    p1 = (size * 0.26, size * 0.54)
    p2 = (size * 0.43, size * 0.70)
    p3 = (size * 0.76, size * 0.32)
    draw.line([p1, p2, p3], fill=color, width=w, joint="curve")
    # round the caps
    r = w / 2
    for (x, y) in (p1, p2, p3):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def make_app_icon(size):
    """Colored rounded-square icon with a white check (for the .app / dmg)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = size * 0.08
    radius = size * 0.22
    rounded_rect(d, [pad, pad, size - pad, size - pad], radius, TEAL)
    draw_check(d, size, (255, 255, 255, 255), width_ratio=0.10)
    return img


def make_tray_template(size):
    """Black-on-transparent template image for the macOS menu bar."""
    scale = 4
    big = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    draw_check(d, size * scale, (0, 0, 0, 255), width_ratio=0.13)
    return big.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(ICONSET, exist_ok=True)
    # App iconset (icns)
    specs = [
        (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
    ]
    for px, name in specs:
        make_app_icon(px).save(os.path.join(ICONSET, name))

    icns_path = os.path.join(HERE, "icon.icns")
    subprocess.run(["iconutil", "-c", "icns", ICONSET, "-o", icns_path], check=True)
    print("wrote", icns_path)

    # Tray template images (must be named *Template for macOS auto-inversion)
    make_tray_template(16).save(os.path.join(HERE, "trayTemplate.png"))
    make_tray_template(32).save(os.path.join(HERE, "trayTemplate@2x.png"))
    print("wrote tray template images")


if __name__ == "__main__":
    main()
