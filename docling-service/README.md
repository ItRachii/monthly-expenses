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

   On Windows, `run-scanner.bat` does it all, one step at a time, and
   stops at the first step that fails:
   1. gets the latest code (`git pull --ff-only`; if that fails, it says
      so and builds the code already there, and if the pull changed the
      script itself it restarts on the new version),
   2. builds the image (which runs the strike check's tests and a sample
      scan),
   3. checks the image was saved,
   4. starts the scanner (`docker compose up -d`, which replaces a running
      older one) and waits until it reports healthy,
   5. checks the running scanner has the strike check, and if it is
      still an older one, replaces it (`--force-recreate`),
   6. starts ngrok for port 8787 in a new window, unless a window from an
      earlier run already serves the address (other ngrok windows, like
      n8n's, are left alone).
   Set `NGROK_URL` in `.env` to your static ngrok domain so the address
   stays the same, and `NGROK_AUTHTOKEN` when that domain belongs to a
   different ngrok account from the one n8n uses. Double-click it or run
   `.\run-scanner.bat`.

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

## Docling's own web page (optional)

To try files by hand in a browser, `docling-ui.bat` starts docling-serve,
Docling's official server, with its web page at http://127.0.0.1:5001/ui
and opens it. Without the script:

    docker compose --profile ui up -d docling-ui
    docker compose --profile ui stop docling-ui

- Ledger does not use it, and the scanner does not start it.
- It is a separate image of about 4.4 GB to download (7.5 GB on disk) and
  uses about 1.5 GB of memory while it reads.
- It runs Docling with its own default settings, so what it shows can
  differ from what Ledger gets. Its Markdown, for one, runs a receipt's
  rows together, which the app avoids by rebuilding rows from the OCR
  pieces. `test_client.py` (below) shows exactly what the app receives.
- It is only reachable from this laptop. Never point ngrok at port 5001:
  the page has no login, so anyone with the address could use it.

## Test a scan

Requests must be encrypted, so a plain `curl` upload gets 401. The test
client seals a file the way the app does:

    docker compose exec -T scanner python test_client.py < order.jpg

Through the tunnel, from any machine with Python (`pip install
cryptography`) and the same secret:

    DOCLING_SECRET=<secret> python test_client.py order.jpg https://<your-domain>

It prints how many pieces of text were found and each one in order. The
scanner returns Docling's text blocks (`items`) with their position
(`box`: left, top, right, bottom) and whether they sat inside a picture
region, the OCR's smaller pieces (`cells`, same boxes), and how long the
scan took. A block can run several receipt rows together, so the app
rebuilds rows from `cells`, where each name and price stays separate.

Struck-out prices ("~~₹120~~ ₹106" on Zepto, Blinkit, BigBasket and
Swiggy) are found in the image, not the text: OCR can't see a strike line
and returns such prices mangled ("Z175") or run into the price paid
("30日297"). `strike.py` looks for a thin line across the middle of a
price piece, longer than any character and crossing the gaps between
them. A piece holding one is split at the line: the struck part comes
back marked `"struck": true` (the app never reads it) and the rest is
read again on its own, both with `"from"` set to the piece they came
from; `"strikeCheck": true` tells the app this was done. Its tests
(`python test_strike.py`) run in every build, and the build's warm-up
scan checks a struck price is left out with the real OCR. An older
scanner image doesn't do this, and the app then guesses struck prices
from the layout, which misses some: rebuild (`docker compose build`)
to get it.

Errors: 401 not sealed with the secret (or replayed, or clock more
than 5 minutes off), 413 too large, 415 not PNG/JPEG/WebP/PDF, 422 no
text found.

## Connect the app (Vercel)

Project → Settings → Environment Variables, for Production and Preview:

- `DOCLING_URL` = `https://<your-domain>`
- `DOCLING_SECRET` = the same secret as in `.env`

Keep the laptop clock on automatic time: requests more than 5 minutes
off are refused.

The app checks the scanner (`/health`) each time the receipt scanner is
opened. If the laptop, Docker or ngrok is off, it says scanning is not
available and to come back later.
