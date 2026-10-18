"""Sends one file to the scanner the way the Ledger app does (sealed with
DOCLING_SECRET) and prints what came back. For checking a setup:

    docker compose exec -T scanner python test_client.py < order.jpg
    python test_client.py order.jpg https://<your-ngrok-domain>   (needs DOCLING_SECRET set)
"""

import json
import os
import sys
import urllib.error
import urllib.request

from envelope import Envelope

path = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "-" else None
base = (sys.argv[2] if len(sys.argv) > 2 else f"http://127.0.0.1:{os.environ.get('PORT', '8787')}").rstrip("/")
data = open(path, "rb").read() if path else sys.stdin.buffer.read()

env = Envelope(os.environ["DOCLING_SECRET"])
body, ts, nonce = env.seal_request(data)
req = urllib.request.Request(
    f"{base}/v1/extract",
    data=body,
    headers={"Content-Type": "application/octet-stream", "X-Ledger-Ts": ts, "X-Ledger-Nonce": nonce},
)
try:
    with urllib.request.urlopen(req, timeout=300) as r:
        result = json.loads(env.open_response(r.read(), r.headers["X-Ledger-Nonce"], nonce))
except urllib.error.HTTPError as e:
    sys.exit(f"Scanner said {e.code}: {e.read().decode(errors='replace')}")
print(f"OK: {len(result['items'])} text pieces in {result['ms']} ms")
for item in result["items"]:
    print("  ", item["text"])
