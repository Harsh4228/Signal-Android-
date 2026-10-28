# Draws the CellMate app icon (white chat bubble with an emerald padlock on a deep green gradient) and writes every size the apps need.
#
#   python scripts/make-icons.py
#
# Needs Pillow (pip install pillow). Re-run after changing the design; the outputs are committed.
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
S = 2048  # drawn large, then scaled down, for smooth edges
# Deep emerald, lighter at the top left (where the light comes from).
LIGHT, MID, DARK = (52, 211, 153), (5, 150, 105), (6, 78, 59)
WHITE = (255, 255, 255)
MINT = (220, 252, 236)


def diagonal(size, stops):
    """A top-left -> bottom-right gradient through the given colours."""
    # (x + y) / 2: the average of a left-right and a top-bottom ramp covers every pixel (no empty corners).
    down = Image.linear_gradient('L').resize((size, size))
    ramp = ImageChops.add(down, down.rotate(90).transpose(Image.FLIP_LEFT_RIGHT), scale=2)
    lut = []
    for ch in range(3):
        for i in range(256):
            t = i / 255 * (len(stops) - 1)
            k = min(int(t), len(stops) - 2)
            a, b = stops[k][ch], stops[k + 1][ch]
            lut.append(round(a + (b - a) * (t - k)))
    return Image.merge('RGB', [ramp] * 3).point(lut)


def background(size):
    bg = diagonal(size, [LIGHT, MID, DARK]).convert('RGBA')
    # Soft light from the top left, and a slightly darker rim: depth without clutter.
    glow = Image.new('L', (size, size), 0)
    ImageDraw.Draw(glow).ellipse([-size * 0.25, -size * 0.35, size * 0.75, size * 0.55], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.12))
    bg = Image.composite(Image.new('RGBA', (size, size), WHITE + (255,)), bg, glow)
    rim = Image.new('L', (size, size), 0)
    ImageDraw.Draw(rim).ellipse([size * 0.05, size * 0.05, size * 0.95, size * 0.95], fill=255)
    rim = ImageChops.invert(rim.filter(ImageFilter.GaussianBlur(size * 0.18)))
    dark = Image.new('RGBA', (size, size), (2, 44, 34, 255))
    return Image.composite(dark, bg, rim.point(lambda v: v * 0.28))


def bubble_shape(u, cx, cy):
    """The chat bubble (with its tail) as a mask, and where the padlock goes."""
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    w, h = 620 * u, 520 * u
    x0, y0 = cx - w / 2, cy - h / 2 - 34 * u
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=168 * u, fill=255)
    d.polygon([(x0 + 120 * u, y0 + h - 70 * u), (x0 + 58 * u, y0 + h + 128 * u), (x0 + 290 * u, y0 + h - 18 * u)], fill=255)
    return m, (cx, y0 + h / 2 + 8 * u)


def padlock(img, u, lx, ly):
    """Emerald padlock with a shaded body and a clean keyhole."""
    shackle = Image.new('L', (S, S), 0)
    sd = ImageDraw.Draw(shackle)
    sw = round(40 * u)
    sd.arc([lx - 100 * u, ly - 190 * u, lx + 100 * u, ly + 10 * u], 180, 360, fill=255, width=sw)
    for x in (lx - 100 * u + sw / 2, lx + 100 * u - sw / 2):
        sd.line([(x, ly - 92 * u), (x, ly - 4 * u)], fill=255, width=sw)
    body = Image.new('L', (S, S), 0)
    ImageDraw.Draw(body).rounded_rectangle([lx - 150 * u, ly - 24 * u, lx + 150 * u, ly + 190 * u], radius=44 * u, fill=255)
    hole = Image.new('L', (S, S), 0)
    hd = ImageDraw.Draw(hole)
    hd.ellipse([lx - 32 * u, ly + 36 * u, lx + 32 * u, ly + 100 * u], fill=255)
    hd.rounded_rectangle([lx - 13 * u, ly + 80 * u, lx + 13 * u, ly + 148 * u], radius=10 * u, fill=255)
    shade = diagonal(S, [(16, 185, 129), (4, 120, 87), (6, 95, 70)]).convert('RGBA')
    img.paste(shade, (0, 0), ImageChops.lighter(shackle, body))
    img.paste(Image.new('RGBA', (S, S), MINT + (255,)), (0, 0), hole)


def glyph(img, scale=1.0):
    u = S * scale / 1024
    mask, (lx, ly) = bubble_shape(u, S / 2, S / 2)
    # Soft shadow under the bubble.
    shadow = mask.filter(ImageFilter.GaussianBlur(40 * u)).point(lambda v: v * 0.45)
    img.paste(Image.new('RGBA', (S, S), (1, 40, 30, 255)), (0, round(26 * u)), shadow)
    # The bubble: white, with a faint mint shading towards the bottom.
    fill = Image.linear_gradient('L').resize((S, S)).point(lambda v: v * 0.55)
    face = Image.composite(Image.new('RGBA', (S, S), MINT + (255,)), Image.new('RGBA', (S, S), WHITE + (255,)), fill)
    img.paste(face, (0, 0), mask)
    padlock(img, u, lx, ly)


def master(shape):
    """shape: 'square' (iOS, full bleed), 'rounded' (Android/desktop), 'circle' (Android round)."""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    mask = Image.new('L', (S, S), 0)
    m = ImageDraw.Draw(mask)
    if shape == 'square':
        m.rectangle([0, 0, S, S], fill=255)
    elif shape == 'circle':
        m.ellipse([0, 0, S - 1, S - 1], fill=255)
    else:
        pad = S * 0.04
        m.rounded_rectangle([pad, pad, S - pad, S - pad], radius=S * 0.225, fill=255)
    img.paste(background(S), (0, 0), mask)
    art = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    glyph(art, scale=0.9 if shape == 'circle' else 1.0)
    # Keep the shadow inside the icon shape.
    art.putalpha(ImageChops.multiply(art.getchannel('A'), mask))
    return Image.alpha_composite(img, art)

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
