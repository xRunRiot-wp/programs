"""Draws the Biome Compass's own 32 needle frames (wooden rim, parchment face, leaf needle, twig tail).
Frame f points (f-16)/32 turns clockwise from straight up, matching how Minecraft's compass angle picks frames."""
import math
from PIL import Image
OUT = 'resources/assets/biomecompass/textures/item'
C = 7.5
RIM_DARK, RIM, RIM_LIGHT = (58, 36, 18, 255), (110, 72, 38, 255), (150, 104, 58, 255)
FACE_DARK, FACE, FACE_LIGHT = (190, 172, 128, 255), (222, 208, 164, 255), (240, 232, 196, 255)
LEAF_DARK, LEAF, LEAF_TIP = (34, 100, 28, 255), (72, 158, 42, 255), (120, 206, 64, 255)
TWIG = (112, 76, 42, 255)
PIVOT = (232, 196, 72, 255)

def base():
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - C, y - C)
            if d > 7.6: continue
            if d > 6.8: c = RIM_DARK
            elif d > 5.6: c = RIM_LIGHT if (x + y) < 13 else RIM          # light catches the top-left of the rim
            elif d > 4.9 and (x + y) > 17: c = FACE_DARK                  # shadow inside the bottom-right rim
            else: c = FACE_LIGHT if (x + y) < 11 else FACE
            im.putpixel((x, y), c)
    for x, y in [(7, 1), (8, 1), (1, 7), (14, 8), (7, 14), (8, 14)]:   # N/E/S/W rim notches
        im.putpixel((x, y), RIM_DARK)
    for p, c in {(12, 0): LEAF_DARK, (13, 0): LEAF, (13, 1): LEAF_TIP, (14, 1): LEAF, (12, 1): LEAF_DARK, (14, 2): LEAF_DARK}.items():
        im.putpixel(p, c)                                                  # little sprout on the rim
    return im

def frame(f):
    im = base()
    a = (f - 16) / 32 * 2 * math.pi
    dx, dy = math.sin(a), -math.cos(a)
    px, py = -dy, dx
    def put(x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < 16 and 0 <= y < 16 and math.hypot(x - C, y - C) < 5.7: im.putpixel((x, y), c)
    t = -3.6
    while t <= 0:                       # twig tail
        put(C + dx * t, C + dy * t, TWIG); t += 0.2
    t = 0
    while t <= 5.2:                     # leaf: wide in the middle, bright tip
        w = 0.9 * math.sin(math.pi * t / 5.2)
        col = LEAF_TIP if t > 3.9 else LEAF
        put(C + dx * t, C + dy * t, col)
        if w > 0.5:
            put(C + dx * t + px * w, C + dy * t + py * w, LEAF_DARK)
            put(C + dx * t - px * w, C + dy * t - py * w, LEAF)
        t += 0.2
    for p in [(7, 7), (8, 7), (7, 8), (8, 8)]: im.putpixel(p, PIVOT)
    return im

for f in range(32):
    frame(f).save(f'{OUT}/biome_compass_{f:02d}.png')
if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:               # preview sheet
        sheet = Image.new('RGBA', (8 * 18, 4 * 18), (40, 40, 40, 255))
        for f in range(32): sheet.paste(frame(f), ((f % 8) * 18 + 1, (f // 8) * 18 + 1))
        sheet.resize((sheet.width * 6, sheet.height * 6), Image.NEAREST).save(sys.argv[1])
