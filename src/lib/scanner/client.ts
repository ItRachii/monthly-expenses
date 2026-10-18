// Calls the Docling scanner (docling-service/) from the server. It runs on
// the owner's laptop behind a tunnel, so it can be switched off at any time:
// every call has a timeout, and "not reachable" is an expected answer, not a
// crash. Server-only: it holds DOCLING_SECRET.

import { deriveKey, openResponse, sealRequest } from "./envelope";
import { scanToLines, type ScanResult } from "./lines";

export type ScanOutcome =
  | { ok: true; lines: string[]; result: ScanResult & { ms?: number } }
  | { ok: false; reason: "unavailable" | "unsupported" | "too-large" | "no-text" };

const HEALTH_TIMEOUT_MS = 5_000;
// One image takes 10 to 30 seconds on the laptop's CPU. Kept under the
// route's 60-second limit, so a slow scan ends as "unavailable", not a crash.
const SCAN_TIMEOUT_MS = 55_000;
// The health answer is reused briefly: opening the scan screen should not
// cost a request through the tunnel every time.
const HEALTH_CACHE_MS = 15_000;
let lastHealth: { at: number; ok: boolean } | null = null;

// ngrok's free plan puts a warning page in front of browser requests; this
// header (and a non-browser user agent) keeps it out of the way.
const HEADERS = { "ngrok-skip-browser-warning": "1", "User-Agent": "ledger-app" };

let cached: { secret: string; key: Buffer } | null = null;

function config(): { url: string; key: Buffer } | null {
  const url = process.env.DOCLING_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.DOCLING_SECRET ?? "";
  if (!url || secret.length < 32) return null;
  if (cached?.secret !== secret) cached = { secret, key: deriveKey(secret) };
  return { url, key: cached.key };
}

/** Whether the scanner is configured and answering right now. */
export async function scannerAvailable(): Promise<boolean> {
  const cfg = config();
  if (!cfg) return false;
  if (lastHealth && Date.now() - lastHealth.at < HEALTH_CACHE_MS) return lastHealth.ok;
  const ok = await checkHealth(cfg.url);
  lastHealth = { at: Date.now(), ok };
  return ok;
}

async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** Reads one image (PNG, JPEG, WebP or PDF) and returns its text lines. */
export async function scanFile(data: Uint8Array): Promise<ScanOutcome> {
  const cfg = config();
  if (!cfg) return { ok: false, reason: "unavailable" };
  const sealed = sealRequest(cfg.key, data);
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/v1/extract`, {
      method: "POST",
      headers: {
        ...HEADERS,
        "Content-Type": "application/octet-stream",
        "X-Ledger-Ts": sealed.ts,
        "X-Ledger-Nonce": sealed.nonce,
      },
      body: new Uint8Array(sealed.body),
      cache: "no-store",
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (res.status === 415) return { ok: false, reason: "unsupported" };
  if (res.status === 413) return { ok: false, reason: "too-large" };
  if (res.status === 422) return { ok: false, reason: "no-text" };
  if (res.status === 401)
    console.error("Scanner refused the request: DOCLING_SECRET differs from the scanner's, or the laptop clock is off.");
  const replyNonce = res.headers.get("x-ledger-nonce");
  if (!res.ok || !replyNonce) return { ok: false, reason: "unavailable" };

  try {
    const plain = openResponse(cfg.key, Buffer.from(await res.arrayBuffer()), replyNonce, sealed.nonce);
    const result = JSON.parse(plain.toString("utf8")) as ScanResult & { ms?: number };
    return { ok: true, lines: scanToLines(result), result };
  } catch {
    console.error("Scanner reply could not be decrypted or read.");
    return { ok: false, reason: "unavailable" };
  }
}
