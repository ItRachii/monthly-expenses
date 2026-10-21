"""Checks for strike.py on drawn images: struck prices are found, plain text,
underlines, arrows and badges are not. Run with `python test_strike.py`
(needs only numpy and Pillow, both in the scanner image)."""

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from strike import find_strike

FONT = ImageFont.load_default(size=40)
failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    print(("PASS " if ok else "FAIL ") + name + (" | " + detail if detail else ""))
    failures += not ok


def piece(text: str, strike: tuple[int, int] | None = None, fg=0, bg=255, under=False, size=(260, 60)) -> np.ndarray:
    """One OCR piece: the text drawn, a line through the middle of the
    characters from strike[0] to strike[1], or an underline."""
    img = Image.new("L", size, bg)
    d = ImageDraw.Draw(img)
    d.text((10, 8), text, fill=fg, font=FONT)
    top, bottom = d.textbbox((10, 8), text, font=FONT)[1::2]
    if strike:
        y = (top + bottom) // 2 + 2
        d.line([(strike[0], y), (strike[1], y)], fill=fg, width=3)
    if under:
        d.line([(10, bottom + 3), (size[0] - 20, bottom + 3)], fill=fg, width=2)
    return np.asarray(img)


def width(text: str) -> int:
    return int(ImageDraw.Draw(Image.new("L", (1, 1))).textlength(text, font=FONT))


w120 = width("120")
check("struck price found", find_strike(piece("120", (6, 14 + w120))) is not None)
check("plain price left alone", find_strike(piece("120")) is None)
check("plain text left alone", find_strike(piece("Item Total 437", size=(420, 60))) is None)
check("underlined text left alone", find_strike(piece("Handling Fee", under=True, size=(320, 60))) is None)

# "₹300 ₹297": only the first price struck; the line's span is reported.
w = width("300 ")
s = find_strike(piece("300 297", (6, 8 + width("300"))))
check("only the struck part", s is not None and s[1] < 10 + w, str(s))

# Dark mode: light text on a dark background.
check("dark mode", find_strike(piece("300", (6, 14 + width("300")), fg=235, bg=24)) is not None)
# Grey struck price beside a black price paid.
img = Image.new("L", (320, 60), 255)
d = ImageDraw.Draw(img)
d.text((10, 8), "175", fill=150, font=FONT)
d.text((150, 8), "65", fill=0, font=FONT)
top, bottom = d.textbbox((10, 8), "175", font=FONT)[1::2]
d.line([(6, (top + bottom) // 2 + 2), (14 + width("175"), (top + bottom) // 2 + 2)], fill=150, width=3)
check("grey strike beside a dark price", find_strike(np.asarray(img)) is not None)

# A back arrow is one long line with only its head: not a strike.
img = Image.new("L", (90, 60), 255)
d = ImageDraw.Draw(img)
d.line([(10, 30), (80, 30)], fill=0, width=4)
d.line([(10, 30), (30, 12)], fill=0, width=4)
d.line([(10, 30), (30, 48)], fill=0, width=4)
check("arrow left alone", find_strike(np.asarray(img)) is None)

# A badge: text on a filled block that covers part of the piece.
img = Image.new("L", (320, 60), 255)
d = ImageDraw.Draw(img)
d.rectangle([(150, 4), (310, 56)], fill=200)
d.text((10, 8), "Basket", fill=0, font=FONT)
d.text((160, 8), "34.25", fill=40, font=FONT)
check("badge left alone", find_strike(np.asarray(img)) is None)

# "44" in a phone number: two crossbars level with each other, a pixel
# apart. They line up like a strike but never make one unbroken line.
img = Image.new("L", (120, 60), 255)
d = ImageDraw.Draw(img)
for x0 in (10, 52):
    d.line([(x0 + 28, 8), (x0 + 28, 52)], fill=0, width=5)  # stem
    d.line([(x0 + 28, 8), (x0 + 6, 33)], fill=0, width=5)  # diagonal, meeting the bar inside the glyph
    d.rectangle([(x0, 36), (x0 + 40, 40)], fill=0)  # crossbar, ending a pixel before the next
check("level crossbars a pixel apart are not a strike", find_strike(np.asarray(img)) is None)

check("blank piece", find_strike(np.full((40, 120), 255, np.uint8)) is None)

if failures:
    raise SystemExit(f"{failures} check(s) failed")
print("all strike checks passed")
