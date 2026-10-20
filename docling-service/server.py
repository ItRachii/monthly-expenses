"""Ledger's Docling scanner: reads an order screenshot, receipt or PDF and
returns its text pieces with their positions, for the app to turn into
expenses.

Security: request and response bodies are encrypted end to end (see
envelope.py), so a tunnel in between only relays ciphertext, and only the
app, which holds the same secret, can send a scan. The upload lives in a
temporary file for the length of one scan and is deleted straight after.
Nothing is logged but timings.
"""

import io
import json
import os
import re
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption

import numpy as np
from PIL import Image

from envelope import Envelope, Rejected
from strike import find_strike

SECRET = os.environ.get("DOCLING_SECRET", "")
if len(SECRET) < 32:
    raise SystemExit("Set DOCLING_SECRET to a random secret of at least 32 characters (openssl rand -hex 32).")
envelope = Envelope(SECRET)
MAX_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "10")) * 1024 * 1024
MAX_PAGES = int(os.environ.get("MAX_PAGES", "10"))

# The first bytes of each accepted type; anything else is refused.
MAGIC = {
    b"\x89PNG\r\n\x1a\n": ".png",
    b"\xff\xd8\xff": ".jpg",
    b"%PDF-": ".pdf",
}


def kind_of(head: bytes) -> str | None:
    for magic, suffix in MAGIC.items():
        if head.startswith(magic):
            return suffix
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


def make_converter() -> DocumentConverter:
    # Whole-page OCR: app screenshots put item rows inside "picture"
    # regions, and without it their text can be skipped.
    opts = PdfPipelineOptions(do_ocr=True, do_table_structure=True)
    opts.ocr_options = RapidOcrOptions(force_full_page_ocr=True, backend="torch")
    return DocumentConverter(
        allowed_formats=[InputFormat.IMAGE, InputFormat.PDF],
        format_options={
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts),
            InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
        },
    )


converter = make_converter()
# One scan at a time: each holds about 1.7 GB while it runs.
lock = threading.Lock()
app = FastAPI(title="Ledger scanner", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/v1/extract")
async def extract(request: Request) -> Response:
    # Read at most the limit (plus the 16-byte tag) before doing anything else.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BYTES + 16:
            raise HTTPException(status_code=413, detail=f"File is larger than {MAX_BYTES // (1024 * 1024)} MB.")
    nonce = request.headers.get("x-ledger-nonce", "")
    try:
        data = envelope.open_request(bytes(body), request.headers.get("x-ledger-ts", ""), nonce)
    except Rejected:
        # Wrong secret, altered in transit, too old, or a replay: one answer for all.
        raise HTTPException(status_code=401, detail="Request could not be verified.")
    del body
    result = await run_in_threadpool(scan, data)
    sealed, reply_nonce = envelope.seal_response(json.dumps(result).encode(), nonce)
    return Response(content=sealed, media_type="application/octet-stream", headers={"X-Ledger-Nonce": reply_nonce})


def scan(data: bytes) -> dict:
    suffix = kind_of(data[:16])
    if suffix is None:
        raise HTTPException(status_code=415, detail="Only PNG, JPEG, WebP and PDF files can be read.")

    started = time.monotonic()
    # Kept for the strike check, which looks at the pixels (images only).
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB") if suffix != ".pdf" else None
    except Exception:
        image = None  # Docling may still read it; just no strike check
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        del data
        with lock:
            result = converter.convert(path, max_num_pages=MAX_PAGES, raises_on_error=False)
    finally:
        Path(path).unlink(missing_ok=True)
    if result.document is None or not result.document.texts:
        raise HTTPException(status_code=422, detail="No text could be read from this file.")

    doc = result.document
    pages = {no: p.size for no, p in doc.pages.items()}
    cells = ocr_cells(result, pages)
    if image is not None:
        with lock:  # shares Docling's OCR engine
            cells = split_struck(cells, image, pages)
    items = []
    for t in doc.texts:
        text = t.text.strip()
        if not text or not t.prov:
            continue
        prov = t.prov[0]
        size = pages.get(prov.page_no)
        box = prov.bbox.to_top_left_origin(size.height) if size else prov.bbox
        items.append(
            {
                "text": text,
                "label": t.label.value,
                "page": prov.page_no,
                # Top-left origin, in the page's own units (pixels for images).
                "box": [round(box.l, 1), round(box.t, 1), round(box.r, 1), round(box.b, 1)],
                # Text Docling filed inside a picture region (item rows with
                # product photos); its markdown export would leave these out.
                "inPicture": bool(t.parent and t.parent.cref.startswith("#/pictures")),
            }
        )
    return {
        "pages": [{"page": no, "width": round(s.width, 1), "height": round(s.height, 1)} for no, s in sorted(pages.items())],
        "items": items,
        "cells": cells,
        # Tells the app struck prices were looked for in the image, so it
        # need not guess them from the layout.
        "strikeCheck": image is not None,
        "ms": round((time.monotonic() - started) * 1000),
    }


def ocr_cells(result, pages: dict) -> list[dict]:
    """The OCR's own text pieces, each with its box. Docling's text items are
    layout blocks that can run several receipt rows together ("Item 54.0
    Fee 9.0 Total 63"); these smaller pieces keep each row's name and price
    apart, so the app can rebuild the rows from their positions."""
    cells, seen = [], set()
    for page in result.pages:
        layout = page.predictions.layout if page.predictions else None
        size = pages.get(page.page_no) or page.size
        for cluster in layout.clusters if layout else []:
            for cell in cluster.cells:
                key = (page.page_no, cell.index)
                text = cell.text.strip()
                if key in seen or not text:
                    continue
                seen.add(key)
                box = cell.rect.to_bounding_box()
                if size:
                    box = box.to_top_left_origin(size.height)
                cells.append(
                    {
                        "text": text,
                        "page": page.page_no,
                        "box": [round(box.l, 1), round(box.t, 1), round(box.r, 1), round(box.b, 1)],
                    }
                )
    return cells


def ocr_reader():
    """Docling's own RapidOCR engine, to read part of a piece again with the
    same models; None if this Docling release keeps it elsewhere."""
    for pipeline in converter.initialized_pipelines.values():
        reader = getattr(getattr(pipeline, "ocr_model", None), "reader", None)
        if reader is not None:
            return reader
    return None


def read_again(reader, crop: Image.Image) -> str | None:
    """The text of a small crop, read by recognition alone; None if it fails."""
    if reader is None or crop.width < 4 or crop.height < 4:
        return None
    # RapidOCR keeps these switches between calls, and Docling's next scan
    # relies on them: put them back however the read goes.
    saved = (reader.use_det, reader.use_cls, reader.use_rec)
    try:
        out = reader(crop, use_det=False, use_cls=False, use_rec=True)
        return " ".join(t for t in (getattr(out, "txts", None) or ()) if t).strip()
    except Exception:
        return None
    finally:
        reader.use_det, reader.use_cls, reader.use_rec = saved


def split_struck(cells: list[dict], image: Image.Image, pages: dict) -> list[dict]:
    """Splits each piece holding a struck-out price into the struck part,
    marked "struck", and what is left of it, read again on its own: "30日297"
    ("₹300" struck, "₹297" paid) becomes a struck piece and "₹297". Pieces
    without digits are left alone: a struck price always has some."""
    gray = np.asarray(image.convert("L"))
    reader = ocr_reader()
    out = []
    for cell in cells:
        size = pages.get(cell["page"])
        if cell["page"] != 1 or not size or not re.search(r"\d", cell["text"]):
            out.append(cell)
            continue
        scale = image.width / size.width
        l, t, r, b = (int(round(v * scale)) for v in cell["box"])
        l, t, r, b = max(0, l), max(0, t), min(image.width, r), min(image.height, b)
        strike = find_strike(gray[t:b, l:r]) if r - l > 4 and b - t > 4 else None
        if strike is None:
            out.append(cell)
            continue
        h = b - t
        x0, x1 = l + strike[0], l + strike[1] + 1
        to_page = lambda x: round(x / scale, 1)  # noqa: E731
        parts = []
        unread = False
        for pl, pr in ((l, x0 - 2), (x1 + 2, r)):
            if pr - pl >= 0.4 * h:
                text = read_again(reader, image.crop((pl, t, pr, b)))
                unread |= text is None
                if text:
                    parts.append((pl, {"text": text, "page": cell["page"], "box": [to_page(pl), cell["box"][1], to_page(pr), cell["box"][3]], "from": cell["text"]}))
        if unread and (x1 - x0) < 0.7 * (r - l):
            # The rest could not be read again: keep the piece whole rather
            # than lose the price paid that shares it.
            out.append(cell)
            continue
        struck_text = read_again(reader, image.crop((x0, t, x1, b))) or cell["text"]
        parts.append((x0, {"text": struck_text, "page": cell["page"], "box": [to_page(x0), cell["box"][1], to_page(x1), cell["box"][3]], "from": cell["text"], "struck": True}))
        out.extend(p for _, p in sorted(parts, key=lambda p: p[0]))
    return out
