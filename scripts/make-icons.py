# Draws the CellMate app icon (white chat bubble with a lock on green) and writes every size the apps need.
#
#   python scripts/make-icons.py
#
# Needs Pillow (pip install pillow). Re-run after changing the design; the outputs are committed.
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
S = 4096  # drawn large, then scaled down, for smooth edges
TOP, BOTTOM = (16, 185, 129), (4, 120, 87)  # green gradient
WHITE = (255, 255, 255)
LOCK = (5, 150, 105)


def gradient(size):
    g = Image.new('RGB', (1, size))
    for y in range(size):
        t = y / (size - 1)
        g.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    return g.resize((size, size))


def glyph(d, scale=1.0, cx=S / 2, cy=S / 2):
    """Chat bubble with a tail and a padlock in it, centred on (cx, cy)."""
    u = S * scale / 1024
    # bubble
    w, h = 600 * u, 500 * u
    x0, y0 = cx - w / 2, cy - h / 2 - 30 * u
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=150 * u, fill=WHITE)
    # tail, bottom left
    d.polygon([(x0 + 110 * u, y0 + h - 60 * u), (x0 + 60 * u, y0 + h + 120 * u), (x0 + 270 * u, y0 + h - 20 * u)], fill=WHITE)
    # padlock: shackle + body
    lx, ly = cx, y0 + h / 2 + 10 * u
    sw = 34 * u
    d.arc([lx - 95 * u, ly - 175 * u, lx + 95 * u, ly + 15 * u], 180, 360, fill=LOCK, width=round(sw))
    d.line([(lx - 95 * u + sw / 2, ly - 80 * u), (lx - 95 * u + sw / 2, ly - 10 * u)], fill=LOCK, width=round(sw))
    d.line([(lx + 95 * u - sw / 2, ly - 80 * u), (lx + 95 * u - sw / 2, ly - 10 * u)], fill=LOCK, width=round(sw))
    d.rounded_rectangle([lx - 140 * u, ly - 20 * u, lx + 140 * u, ly + 180 * u], radius=36 * u, fill=LOCK)
    # keyhole
    d.ellipse([lx - 30 * u, ly + 35 * u, lx + 30 * u, ly + 95 * u], fill=WHITE)
    d.rectangle([lx - 12 * u, ly + 80 * u, lx + 12 * u, ly + 140 * u], fill=WHITE)


def master(shape):
    """shape: 'square' (iOS, full bleed), 'rounded' (Android/desktop), 'circle' (Android round)."""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bg = gradient(S).convert('RGBA')
    mask = Image.new('L', (S, S), 0)
    m = ImageDraw.Draw(mask)
    if shape == 'square':
        m.rectangle([0, 0, S, S], fill=255)
    elif shape == 'circle':
        m.ellipse([0, 0, S - 1, S - 1], fill=255)
    else:
        pad = S * 0.04
        m.rounded_rectangle([pad, pad, S - pad, S - pad], radius=S * 0.22, fill=255)
    img.paste(bg, (0, 0), mask)
    glyph(ImageDraw.Draw(img), scale=0.92 if shape == 'circle' else 1.0)
    return img


def save(img, path, size, rgb=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    out = img.resize((size, size), Image.LANCZOS)
    (out.convert('RGB') if rgb else out).save(path, optimize=True)
    print('  ', path.relative_to(ROOT), f'{size}px')


rounded, circle, square = master('rounded'), master('circle'), master('square')

# Android launcher icons
res = ROOT / 'apps/mobile/android/app/src/main/res'
for dpi, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    save(rounded, res / f'mipmap-{dpi}/ic_launcher.png', px)
    save(circle, res / f'mipmap-{dpi}/ic_launcher_round.png', px)

# iOS: one 1024px icon, no transparency (Apple rounds the corners itself)
ios = ROOT / 'apps/mobile/ios/MeetMe/Images.xcassets/AppIcon.appiconset'
save(square, ios / 'AppIcon-1024.png', 1024, rgb=True)
(ios / 'Contents.json').write_text(json.dumps({
    'images': [{'filename': 'AppIcon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
    'info': {'author': 'xcode', 'version': 1},
}, indent=2) + '\n')

# Desktop: electron-builder makes the .ico / .icns from build/icon.png
desk = ROOT / 'apps/desktop'
save(rounded, desk / 'build/icon.png', 1024)

# Web app / iPhone home screen
web = ROOT / 'apps/desktop/web/public'
save(square, web / 'apple-touch-icon.png', 180, rgb=True)
save(rounded, web / 'icon-192.png', 192)
save(rounded, web / 'icon-512.png', 512)
save(rounded, web / 'favicon.png', 64)
