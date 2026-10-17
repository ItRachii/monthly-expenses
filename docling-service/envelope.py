"""End-to-end encryption between the Ledger app and this scanner.

Tunnels such as ngrok end TLS on their own servers, so they could read
whatever passes through. Every request and response body is therefore
sealed with AES-256-GCM under a key only the app and this scanner hold;
the tunnel relays ciphertext it cannot read or alter.

Protocol "ledger-scan-v1" (the app's side lives in the app's code):
- Both ends derive the AES key from the shared DOCLING_SECRET with
  HKDF-SHA256 (info "ledger-scan-v1 aes-256-gcm"); the secret itself never
  travels.
- Request: body = ciphertext + 16-byte tag of the file. Headers
  X-Ledger-Ts (Unix seconds) and X-Ledger-Nonce (12 random bytes,
  base64url, the GCM nonce). Both are bound in as associated data, so
  neither can be changed. A request older or newer than 5 minutes, or one
  reusing a nonce, is refused: a captured request cannot be replayed.
- Response: body = ciphertext + tag of the JSON result, header
  X-Ledger-Nonce with its own fresh nonce, associated data tied to the
  request's nonce, so a response cannot be swapped onto another request.
- Only holders of the key can produce a body that decrypts, so this is
  also the authentication: no key or password is ever sent in a header.
"""

import base64
import os
import threading
import time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

VERSION = "ledger-scan-v1"
MAX_SKEW_S = 300
NONCE_BYTES = 12


def derive_key(secret: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=f"{VERSION} aes-256-gcm".encode()).derive(
        secret.encode()
    )


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def request_aad(ts: str, nonce: str) -> bytes:
    return f"{VERSION}|req|{ts}|{nonce}".encode()


def response_aad(request_nonce: str) -> bytes:
    return f"{VERSION}|res|{request_nonce}".encode()


class Rejected(Exception):
    """Any failure to open a request. Deliberately says nothing about why."""


class Envelope:
    def __init__(self, secret: str):
        self._aead = AESGCM(derive_key(secret))
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def open_request(self, body: bytes, ts: str, nonce: str) -> bytes:
        try:
            sent = int(ts)
            iv = unb64u(nonce)
        except (ValueError, TypeError):
            raise Rejected()
        now = time.time()
        if len(iv) != NONCE_BYTES or abs(now - sent) > MAX_SKEW_S:
            raise Rejected()
        try:
            plain = self._aead.decrypt(iv, body, request_aad(ts, nonce))
        except Exception:
            raise Rejected()
        # Only remember nonces of genuine requests, so junk cannot fill the cache.
        with self._lock:
            for n, t in list(self._seen.items()):
                if now - t > 2 * MAX_SKEW_S:
                    del self._seen[n]
            if nonce in self._seen:
                raise Rejected()
            self._seen[nonce] = now
        return plain

    def seal_response(self, plain: bytes, request_nonce: str) -> tuple[bytes, str]:
        iv = os.urandom(NONCE_BYTES)
        return self._aead.encrypt(iv, plain, response_aad(request_nonce)), b64u(iv)

    # Used by the test client, which plays the app's part.
    def seal_request(self, plain: bytes) -> tuple[bytes, str, str]:
        ts, nonce = str(int(time.time())), b64u(os.urandom(NONCE_BYTES))
        return self._aead.encrypt(unb64u(nonce), plain, request_aad(ts, nonce)), ts, nonce

    def open_response(self, body: bytes, nonce: str, request_nonce: str) -> bytes:
        return self._aead.decrypt(unb64u(nonce), body, response_aad(request_nonce))
