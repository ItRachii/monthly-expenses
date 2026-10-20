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
# Docling is pinned to the release tested with Ledger. To take the newest
# release instead, build with --build-arg DOCLING_VERSION=latest; change
# DOCLING_REFRESH (any new value, e.g. the date) to look again on a later
# build, since Docker otherwise reuses the version it fetched last time.
# The CPU index stays available in case a new release needs newer torch.
ARG DOCLING_VERSION=2.140.0
ARG DOCLING_REFRESH=
RUN if [ "$DOCLING_VERSION" = latest ]; then spec=docling; else spec="docling==$DOCLING_VERSION"; fi \
 && pip install --upgrade --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt "$spec" \
 && python -c "from importlib.metadata import version as v; print('Installed docling', v('docling'), 'torch', v('torch'))"

# Runs as a normal user, not root.
RUN useradd --uid 10001 --no-create-home --home-dir /app --shell /usr/sbin/nologin scanner

# The strike check's tests run first, then the warm-up scans a sample image:
# it bakes the models in, and a Docling release that no longer works here
# (or no longer lets the strike check re-read a crop) fails the build
# instead of the scans.
# Ownership is set in this same step: a later step would make Docker copy
# the models (and, before, all of site-packages) into a new layer, which
# took minutes on Docker Desktop.
COPY server.py envelope.py strike.py test_strike.py test_client.py warmup.py ./
RUN python test_strike.py && python warmup.py && rm -rf warmup.py /tmp/* \
 && chown -R scanner /app /opt/models \
 && chmod -R a+rX /usr/local/lib/python3.11/site-packages/rapidocr
USER scanner

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health', timeout=4)"
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT} --workers 1"]
