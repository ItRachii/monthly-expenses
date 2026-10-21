"""Finds prices struck out on order screenshots ("₹120" crossed through,
next to the ₹106 paid). OCR reads a strike line as part of the text, so a
struck price comes back mangled ("Z175") or run into the price paid
("Z423252", "30日297"). This looks at the pixels instead: a strike is a thin
line across the middle of the text, longer than any glyph.

Pure numpy over a grayscale crop of one OCR piece, so it is unit-tested
with drawn images (test_strike.py).
"""

import numpy as np

# How far a pixel must differ from the background to count as ink, as a
# share of the piece's strongest contrast (grey struck text is fainter than
# the price paid next to it), and never below this many grey levels.
INK_SHARE = 0.3
MIN_INK = 30


def _runs(row: np.ndarray, max_gap: int = 1) -> list[tuple[int, int]]:
    """Runs of ink along one pixel row, bridging gaps of up to max_gap pixels."""
    xs = np.flatnonzero(row)
    if xs.size == 0:
        return []
    runs, start, prev = [], xs[0], xs[0]
    for x in xs[1:]:
        if x - prev > max_gap + 1:
            runs.append((start, prev))
            start = x
        prev = x
    runs.append((start, prev))
    return runs


def find_strike(gray: np.ndarray) -> tuple[int, int] | None:
    """The x-range (left, right, inclusive) of a strike line in the crop of
    one OCR piece, or None. A strike is accepted when, in the middle band of
    the text's height, a few adjacent pixel rows (not the whole band: that
    is a filled badge) carry one unbroken run of ink longer than about one
    and a half glyphs."""
    g = gray.astype(np.int16)
    if g.ndim != 2 or min(g.shape) < 6:
        return None
    border = np.concatenate([g[0], g[-1], g[:, 0], g[:, -1]])
    bg = int(np.median(border))
    diff = np.abs(g - bg)
    contrast = float(np.percentile(diff, 99))
    if contrast < MIN_INK + 10:
        return None
    ink = diff > max(MIN_INK, INK_SHARE * contrast)

    rows = np.flatnonzero(ink.any(axis=1))
    if rows.size == 0:
        return None
    top, bottom = int(rows[0]), int(rows[-1])
    h = bottom - top + 1
    if h < 6:
        return None
    band = range(top + int(0.35 * h), top + int(0.8 * h) + 1)
    need = max(12, 1.4 * h)

    hits: dict[int, tuple[int, int]] = {}
    for y in band:
        best = max(_runs(ink[y]), key=lambda r: r[1] - r[0], default=None)
        if best and best[1] - best[0] + 1 >= need:
            hits[y] = best
    if not hits:
        return None
    # A drawn line has at least one pixel row with no break at all. Glyph
    # strokes that only line up ("44": two crossbars a pixel apart) do not.
    if not any(r[1] - r[0] + 1 >= need for y in hits for r in _runs(ink[y], max_gap=0)):
        return None
    # The line is thin: adjacent rows only, a small share of the band.
    if len(hits) > max(3, 0.25 * h) or len(hits) > 0.6 * len(band):
        return None
    ys = sorted(hits)
    if ys[-1] - ys[0] + 1 > len(hits) + 1:
        return None  # rows scattered over the band: glyph strokes, not one line
    left, right = min(r[0] for r in hits.values()), max(r[1] for r in hits.values())
    # A strike crosses the gaps between characters (and runs past the first
    # and last): columns where the line is the only ink. Bold glyphs that
    # merely touch have none.
    text = ink[top : bottom + 1, left : right + 1].copy()
    text[ys[0] - 1 - top : ys[-1] + 2 - top] = False
    glyph = text.any(axis=0)
    bridges = int(np.count_nonzero(~glyph))
    if bridges < max(2, 0.08 * (right - left + 1)):
        return None
    # And it crosses at least two characters (₹ and a digit). An arrow's
    # shaft ("←", read by OCR as "7") has only its head.
    glyphs = int(np.count_nonzero(glyph[1:] & ~glyph[:-1])) + int(glyph[0])
    if glyphs < 2:
        return None
    return left, right
