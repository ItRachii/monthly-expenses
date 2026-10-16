# Ledger scanner (Docling)

Reads order screenshots, receipts and PDFs for Ledger. Runs on your own
machine in Docker; ngrok gives it a public HTTPS address so the Vercel
app can reach it. Uploads are kept only for the length of one scan.

## Run it

1. Install Docker Desktop (Windows / macOS) or Docker Engine (Linux).
2. In this folder, create `.env` from `.env.example` and set
   `DOCLING_API_KEY` to a long random secret (see the file for commands).
3. Build and start (the first build downloads about 1.5 GB and takes a
   while; later starts are quick):

       docker compose up -d --build

4. Check it is up (it needs about a minute after start to load models):

       curl http://127.0.0.1:8787/health          -> {"ok":true}

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

    curl -H "X-API-Key: $DOCLING_API_KEY" -F "file=@order.jpg" \
         https://<your-domain>/v1/extract

Returns every piece of text with its position (`box`: left, top, right,
bottom), whether it sat inside a picture region, and how long the scan
took. Errors: 401 wrong key, 413 too large, 415 not PNG/JPEG/WebP/PDF,
422 no text found.

## Connect the app (Vercel)

Project → Settings → Environment Variables, for Production and Preview:

- `DOCLING_URL` = `https://<your-domain>`
- `DOCLING_API_KEY` = the same secret as in `.env`
