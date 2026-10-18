"""Run once while the image is built: scans a small generated receipt so
Docling and RapidOCR download their models into the image, and checks the
text comes back. Containers then start with everything on disk and never
fetch models at runtime; a Docling release that cannot read it fails the
build."""

import io
import os

from PIL import Image, ImageDraw, ImageFont

os.environ.setdefault("DOCLING_SECRET", "x" * 32)  # server.py refuses to load without one
import server  # noqa: E402  (builds the converter, fetching the layout models)

img = Image.new("RGB", (640, 200), "white")
font = ImageFont.load_default(size=32)
ImageDraw.Draw(img).text((30, 40), "Item Total", fill="black", font=font)
ImageDraw.Draw(img).text((30, 110), "Grand Total 104.50", fill="black", font=font)
buf = io.BytesIO()
img.save(buf, "PNG")

text = " ".join(i["text"] for i in server.scan(buf.getvalue())["items"])  # fetches the OCR models
if "104.50" not in text or "Total" not in text:
    raise SystemExit(f"Docling did not read the sample receipt correctly: {text!r}")
print("models ready, sample read:", text)
