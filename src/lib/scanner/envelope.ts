// The app's half of the "ledger-scan-v1" encryption shared with the Docling
// scanner (docling-service/envelope.py, which documents the protocol). The
// tunnel in between only ever relays ciphertext. Server-only: it needs the
// shared secret and Node's crypto.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "ledger-scan-v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function deriveKey(secret: string): Buffer {
  // An empty salt is HKDF's all-zero salt, the same as Python's salt=None.
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), `${VERSION} aes-256-gcm`, 32));
}

export interface SealedRequest {
  body: Buffer;
  /** X-Ledger-Ts: Unix seconds. */
  ts: string;
  /** X-Ledger-Nonce: the GCM nonce, base64url. */
  nonce: string;
}

/** Encrypts a file for the scanner. `iv` and `now` are fixed only in tests. */
export function sealRequest(key: Buffer, plain: Uint8Array, iv: Buffer = randomBytes(NONCE_BYTES), now = Date.now()): SealedRequest {
  const ts = String(Math.floor(now / 1000));
  const nonce = iv.toString("base64url");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${VERSION}|req|${ts}|${nonce}`));
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return { body, ts, nonce };
}

/** Decrypts the scanner's reply; throws if it was altered or belongs to another request. */
export function openResponse(key: Buffer, body: Buffer, replyNonce: string, requestNonce: string): Buffer {
  const iv = Buffer.from(replyNonce, "base64url");
  if (iv.length !== NONCE_BYTES || body.length < TAG_BYTES) throw new Error("Malformed scanner reply.");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`${VERSION}|res|${requestNonce}`));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
}
