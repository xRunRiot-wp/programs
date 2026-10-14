"""Draws the Legendary Clock: a gold pocket watch whose face is a Poke Ball (red top, white bottom, black band, button),
with a gold hand, plus the faint outline icon for the empty Curios clock slot."""
import math
from PIL import Image
R = 'resources/assets/legendaryclock/textures'
C = 7.5
GOLD_DARK, GOLD, GOLD_LIGHT = (122, 84, 18, 255), (214, 166, 44, 255), (252, 222, 104, 255)
RED_DARK, RED, RED_LIGHT = (150, 28, 30, 255), (214, 52, 48, 255), (246, 112, 96, 255)
WHITE_DARK, WHITE = (186, 186, 196, 255), (240, 240, 244, 255)
BLACK = (28, 24, 30, 255)

def clock():
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    cy = 8.5                                      # dial sits a pixel low to leave room for the crown
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - C, y - cy)
            if d > 7.1: continue
            if d > 6.3: c = GOLD_DARK
            elif d > 5.4: c = GOLD_LIGHT if (x + y) < 15 else GOLD     # light on the top-left of the rim
            elif abs(y - cy) < 0.8: c = BLACK                          # Poke Ball band
            elif y < cy: c = RED_LIGHT if (x + y) < 12 else (RED_DARK if d > 4.4 and x > 9 else RED)
            else: c = WHITE_DARK if d > 4.4 and (x + y) > 18 else WHITE
            im.putpixel((x, y), c)
    for p in [(7, 0), (8, 0), (6, 1), (9, 1)]: im.putpixel(p, GOLD_DARK)   # crown ring
    for p in [(7, 1), (8, 1)]: im.putpixel(p, GOLD_LIGHT)
    for x in range(6, 10):                                                  # centre button
        for y in range(7, 11):
            im.putpixel((x, y), BLACK if x in (6, 9) or y in (7, 10) else WHITE)
    for p in [(9, 5), (10, 4), (11, 3)]: im.putpixel(p, GOLD_LIGHT)          # hand toward 1 o'clock
    return im

def slot():
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - C, y - 8.5)
            if 5.6 < d <= 6.6 or (abs(y - 8.5) < 0.8 and d < 5.6) or (x in (7, 8) and y == 1):
                im.putpixel((x, y), (255, 255, 255, 70))
    return im

clock().save(f'{R}/item/legendary_clock.png')
slot().save(f'{R}/slot/empty_legendary_clock_slot.png')
if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:               # preview: item and slot icon, enlarged on a grey background
        sheet = Image.new('RGBA', (36, 18), (60, 60, 60, 255))
        sheet.alpha_composite(clock(), (1, 1)); sheet.alpha_composite(slot(), (19, 1))
        sheet.resize((sheet.width * 12, sheet.height * 12), Image.NEAREST).save(sys.argv[1])
