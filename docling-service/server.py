"""Ledger's Docling scanner: reads an order screenshot, receipt or PDF and
returns its text pieces with their positions, for the app to turn into
expenses.

Privacy: the upload lives only in a temporary file for the length of one
scan and is deleted straight after, whatever happens. Nothing is logged
but timings. Every call except /health needs the API key.
"""

import hmac
import os
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption

API_KEY = os.environ.get("DOCLING_API_KEY", "")
if len(API_KEY) < 24:
    raise SystemExit("Set DOCLING_API_KEY to a random secret of at least 24 characters.")
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
def extract(file: UploadFile = File(...), x_api_key: str = Header(default="")) -> dict:
    if not hmac.compare_digest(x_api_key.encode(), API_KEY.encode()):
        raise HTTPException(status_code=401, detail="Missing or wrong API key.")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File is larger than {MAX_BYTES // (1024 * 1024)} MB.")
    suffix = kind_of(data[:16])
    if suffix is None:
        raise HTTPException(status_code=415, detail="Only PNG, JPEG, WebP and PDF files can be read.")

    started = time.monotonic()
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
        "ms": round((time.monotonic() - started) * 1000),
    }
