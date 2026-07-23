#!/usr/bin/env python3
"""Generate the app .icns and the menu-bar (tray) template PNGs.

The app icon is a glossy "crystal" checkmark on a teal gradient squircle,
drawn entirely with Pillow (gradient, soft shadow, top sheen, edge rim light).
The tray icon must stay a flat black-on-transparent template (macOS inverts it
for light/dark menu bars), so it's just a clean checkmark.
"""
import math
import os
import subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
ICONSET = os.path.join(HERE, "icon.iconset")

# Render everything large, then downscale each size for crisp anti-aliasing.
R = 1024

# Teal "crystal" gradient (bright aqua -> deep teal).
C_TOP = (62, 224, 198)     # #3ee0c6
C_BOT = (11, 110, 99)      # #0b6e63


def linear_gradient(size, c1, c2, angle_deg=52):
    """A diagonal linear gradient, built small and scaled up (fast + smooth)."""
    small = 256
    g = Image.new("RGB", (small, small))
    px = g.load()
    a = math.radians(angle_deg)
    dx, dy = math.cos(a), math.sin(a)
    projs = [x * dx + y * dy for x in (0, small) for y in (0, small)]
    pmin, pmax = min(projs), max(projs)
    span = (pmax - pmin) or 1
    for y in range(small):
        for x in range(small):
            t = ((x * dx + y * dy) - pmin) / span
            px[x, y] = (
                int(c1[0] + (c2[0] - c1[0]) * t),
                int(c1[1] + (c2[1] - c1[1]) * t),
                int(c1[2] + (c2[2] - c1[2]) * t),
            )
    return g.resize((size, size), Image.BICUBIC)


def squircle_mask(size, radius):
    """Alpha mask of a rounded square (Apple-ish), anti-aliased via supersampling."""
    s = size * 2
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    pad = int(size * 0.085) * 2
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=radius * 2, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def check_points(size):
    p1 = (size * 0.290, size * 0.530)
    p2 = (size * 0.435, size * 0.675)
    p3 = (size * 0.735, size * 0.350)
    return p1, p2, p3


def draw_check_layer(size, color, width_ratio=0.115, offset=(0, 0)):
    """A checkmark stroke with round caps/joins on its own transparent layer."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w = max(2, int(size * width_ratio))
    pts = [(x + offset[0], y + offset[1]) for (x, y) in check_points(size)]
    d.line(pts, fill=color, width=w, joint="curve")
    r = w / 2
    for (x, y) in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)
    return layer


def make_app_icon(size):
    img = Image.new("RGBA", (R, R), (0, 0, 0, 0))

    radius = R * 0.235
    mask = squircle_mask(R, radius)

    # 1) Gradient body.
    body = linear_gradient(R, C_TOP, C_BOT).convert("RGBA")
    body.putalpha(mask)
    img = Image.alpha_composite(img, body)

    # 2) Top sheen — a soft white highlight across the upper third (glass gloss).
    sheen = Image.new("L", (R, R), 0)
    sd = ImageDraw.Draw(sheen)
    sd.ellipse([-R * 0.35, -R * 0.62, R * 1.35, R * 0.46], fill=110)
    sheen = sheen.filter(ImageFilter.GaussianBlur(R * 0.05))
    sheen = ImageChops.multiply(sheen, mask)  # clip to squircle
    white = Image.new("RGBA", (R, R), (255, 255, 255, 0))
    white.putalpha(sheen)
    img = Image.alpha_composite(img, white)

    # 3) Subtle inner rim light along the top edge for a crystal bevel.
    rim = Image.new("L", (R, R), 0)
    rd = ImageDraw.Draw(rim)
    pad = int(R * 0.085)
    rd.rounded_rectangle(
        [pad, pad, R - pad, R - pad], radius=radius, outline=90, width=max(2, int(R * 0.006))
    )
    rim = rim.filter(ImageFilter.GaussianBlur(R * 0.004))
    rim_top = Image.new("L", (R, R), 0)
    ImageDraw.Draw(rim_top).rectangle([0, 0, R, int(R * 0.55)], fill=255)
    rim = ImageChops.multiply(rim, rim_top)
    rim = ImageChops.multiply(rim, mask)
    rimw = Image.new("RGBA", (R, R), (255, 255, 255, 0))
    rimw.putalpha(rim)
    img = Image.alpha_composite(img, rimw)

    # 4) Drop shadow of the checkmark for depth.
    shadow = draw_check_layer(R, (3, 45, 40, 150), width_ratio=0.118, offset=(0, R * 0.018))
    shadow = shadow.filter(ImageFilter.GaussianBlur(R * 0.02))
    sa = ImageChops.multiply(shadow.split()[3], mask)
    shadow.putalpha(sa)
    img = Image.alpha_composite(img, shadow)

    # 5) The checkmark, filled with a soft white->cool-white vertical gradient.
    check_mask = draw_check_layer(R, (255, 255, 255, 255), width_ratio=0.115).split()[3]
    check_fill = linear_gradient(R, (255, 255, 255), (214, 245, 240), angle_deg=90).convert("RGBA")
    check_fill.putalpha(check_mask)
    img = Image.alpha_composite(img, check_fill)

    # 6) A slim gloss highlight riding the top edge of the stroke.
    hi = draw_check_layer(R, (255, 255, 255, 235), width_ratio=0.05, offset=(0, -R * 0.028))
    hi_alpha = ImageChops.multiply(hi.split()[3], check_mask)  # keep it on the stroke
    hi_alpha = hi_alpha.filter(ImageFilter.GaussianBlur(R * 0.004))
    hi.putalpha(hi_alpha)
    img = Image.alpha_composite(img, hi)

    return img.resize((size, size), Image.LANCZOS)


def make_tray_template(size):
    """Flat black-on-transparent checkmark for the macOS menu bar."""
    s = size * 4
    layer = draw_check_layer(s, (0, 0, 0, 255), width_ratio=0.13)
    return layer.resize((size, size), Image.LANCZOS)


def make_tray_alert(size):
    """Amber checkmark (non-template) shown in the menu bar when tasks are overdue."""
    s = size * 4
    layer = draw_check_layer(s, (245, 158, 11, 255), width_ratio=0.13)  # amber #f59e0b
    return layer.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(ICONSET, exist_ok=True)
    specs = [
        (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
    ]
    master = make_app_icon(1024)
    for px, name in specs:
        master.resize((px, px), Image.LANCZOS).save(os.path.join(ICONSET, name))

    icns_path = os.path.join(HERE, "icon.icns")
    subprocess.run(["iconutil", "-c", "icns", ICONSET, "-o", icns_path], check=True)
    print("wrote", icns_path)

    make_tray_template(16).save(os.path.join(HERE, "trayTemplate.png"))
    make_tray_template(32).save(os.path.join(HERE, "trayTemplate@2x.png"))
    make_tray_alert(16).save(os.path.join(HERE, "trayAlert.png"))
    make_tray_alert(32).save(os.path.join(HERE, "trayAlert@2x.png"))
    print("wrote tray template + alert images")


if __name__ == "__main__":
    main()
