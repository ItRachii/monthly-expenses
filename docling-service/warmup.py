"""Run once while the image is built: converts a tiny generated image so
Docling and RapidOCR download their models into the image. Containers then
start with everything on disk and never fetch models at runtime."""

import tempfile

from PIL import Image, ImageDraw

import os

os.environ.setdefault("DOCLING_SECRET", "x" * 32)  # server.py refuses to load without one
import server  # noqa: E402  (builds the converter, fetching the layout models)

img = Image.new("RGB", (480, 160), "white")
ImageDraw.Draw(img).text((20, 60), "Item Total 100.00", fill="black")
with tempfile.NamedTemporaryFile(suffix=".png") as f:
    img.save(f.name)
    server.converter.convert(f.name)  # fetches the OCR models
print("models ready")
