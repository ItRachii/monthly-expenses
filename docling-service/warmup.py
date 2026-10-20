"""Run once while the image is built: scans a small generated receipt so
Docling and RapidOCR download their models into the image, and checks the
text comes back, with its struck-out price found and left out. Containers
then start with everything on disk and never fetch models at runtime; a
Docling release that cannot read it fails the build."""

import io
import os

from PIL import Image, ImageDraw, ImageFont

os.environ.setdefault("DOCLING_SECRET", "x" * 32)  # server.py refuses to load without one
import server  # noqa: E402  (builds the converter, fetching the layout models)

img = Image.new("RGB", (640, 280), "white")
font = ImageFont.load_default(size=32)
draw = ImageDraw.Draw(img)
draw.text((30, 40), "Item Total", fill="black", font=font)
draw.text((30, 110), "Grand Total 104.50", fill="black", font=font)
# "Juice 250 199", the 250 struck out as order apps print it.
draw.text((30, 190), "Juice", fill="black", font=font)
draw.text((380, 190), "250 199", fill="black", font=font)
top, bottom = draw.textbbox((380, 190), "250", font=font)[1::2]
draw.line([(375, (top + bottom) // 2 + 2), (385 + draw.textlength("250", font=font), (top + bottom) // 2 + 2)], fill="black", width=3)
buf = io.BytesIO()
img.save(buf, "PNG")

result = server.scan(buf.getvalue())  # fetches the OCR models
text = " ".join(i["text"] for i in result["items"])
if "104.50" not in text or "Total" not in text:
    raise SystemExit(f"Docling did not read the sample receipt correctly: {text!r}")
kept = " ".join(c["text"] for c in result["cells"] if not c.get("struck"))
if not any(c.get("struck") for c in result["cells"]) or "250" in kept or "199" not in kept:
    raise SystemExit(f"The struck-out price was not found and left out: {result['cells']!r}")
print("models ready, sample read:", text, "| kept:", kept)
