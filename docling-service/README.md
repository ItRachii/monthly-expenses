# Ledger scanner (Docling)

Reads order screenshots, receipts and PDFs for Ledger. Runs on your own
machine in Docker; ngrok gives it a public HTTPS address so the Vercel
app can reach it. Uploads are kept only for the length of one scan.

## Security in transit

ngrok ends HTTPS on its own servers before forwarding to your laptop, so
HTTPS alone would let ngrok see the screenshot and the result. The app and
the scanner therefore encrypt every body themselves (AES-256-GCM, key
derived from `DOCLING_SECRET`, see `envelope.py`):

- ngrok, and anyone between, relays only ciphertext. It can still see
  that a scan happened, its size, its timing and the status code.
- The secret never travels; only something sealed with it is accepted,
  so a request without the secret gets 401 and no scan runs.
- Each request carries a timestamp and a one-time nonce: a captured
  request cannot be replayed, and one older than 5 minutes is refused.
- Each response is bound to its request and cannot be altered or swapped.
- Port 8787 listens on 127.0.0.1 only; nothing on your network can reach
  it except through the tunnel.

## Run it

1. Install Docker Desktop (Windows / macOS) or Docker Engine (Linux).
2. In this folder, create `.env` from `.env.example` and set
   `DOCLING_SECRET` to a long random secret (see the file for commands).
3. Build and start (the first build downloads about 1.5 GB and takes a
   while; later starts are quick):

       docker compose up -d --build

4. Check it is up (it needs about a minute after start to load models):

       curl http://127.0.0.1:8787/health          -> {"ok":true}

## Docling version

The image installs the Docling release tested with Ledger (set by
`DOCLING_VERSION` in the Dockerfile). To move to the newest release:

    docker compose build --pull --build-arg DOCLING_VERSION=latest --build-arg DOCLING_REFRESH=2026-10-17
    docker compose up -d

- Change `DOCLING_REFRESH` to today's date each time: Docker otherwise
  reuses the version it fetched on an earlier build. `--pull` also takes
  the newest Python base image, with its security fixes.
- The build prints `Installed docling <version>` and then scans a sample
  receipt. If the new release cannot read it, the build stops and your
  running scanner is left as it was.
- Check what is running with `docker compose exec scanner pip show docling`.
- Then scan a real order with the test client (below). If it reads well,
  set that version as the `DOCLING_VERSION` default so every rebuild
  gets the same one.

## Expose it with ngrok

n8n keeps port 5678; the scanner is on **8787**.

    ngrok http 8787

Using your free static ngrok domain (Dashboard → Domains):

    ngrok http --url=<your-domain>.ngrok-free.app 8787

To run n8n and the scanner from one ngrok agent, list both in
`ngrok.yml` and start them with `ngrok start --all`:

    version: 3
    agent:
      authtoken: <your token>
    endpoints:
      - name: n8n
        url: <your-n8n-domain>
        upstream:
          url: 5678
      - name: scanner
        url: <your-scanner-domain>
        upstream:
          url: 8787

The free plan includes one static domain; a second fixed address may
need a paid plan or a random ngrok URL. If your ngrok version rejects
this file, check its agent configuration docs: the format has changed
between versions.

## Test a scan

Requests must be encrypted, so a plain `curl` upload gets 401. The test
client seals a file the way the app does:

    docker compose exec -T scanner python test_client.py < order.jpg

Through the tunnel, from any machine with Python (`pip install
cryptography`) and the same secret:

    DOCLING_SECRET=<secret> python test_client.py order.jpg https://<your-domain>

It prints how many pieces of text were found and each one in order. The
scanner returns every piece with its position (`box`: left, top, right,
bottom), whether it sat inside a picture region, and how long the scan
took. Errors: 401 not sealed with the secret (or replayed, or clock more
than 5 minutes off), 413 too large, 415 not PNG/JPEG/WebP/PDF, 422 no
text found.

## Connect the app (Vercel)

Project → Settings → Environment Variables, for Production and Preview:

- `DOCLING_URL` = `https://<your-domain>`
- `DOCLING_SECRET` = the same secret as in `.env`

Keep the laptop clock on automatic time: requests more than 5 minutes
off are refused.
