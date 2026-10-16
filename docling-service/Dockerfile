# Ledger's Docling scanner, CPU only. Works on Intel/AMD (amd64) and Apple
# Silicon / ARM (arm64) machines. Models are baked in at build time, so the
# container starts without downloading anything.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/models/hf \
    OMP_NUM_THREADS=4 \
    PORT=8787

# Shared libraries the image and OCR stack load at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only PyTorch first, from its own index, so docling does not pull the
# much larger CUDA build.
RUN pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY server.py warmup.py ./
RUN python warmup.py && rm warmup.py

# Run as a normal user, not root.
RUN useradd --system --uid 10001 --home /app scanner \
 && chown -R scanner /app /opt/models \
 && chmod -R a+rX /usr/local/lib/python3.11/site-packages
USER scanner

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health', timeout=4)"
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT} --workers 1"]
