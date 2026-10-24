import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { scanFile, scannerStatus } from "@/lib/scanner/client";
import { recordScanEvent } from "@/lib/scanEvents";
import { isAttemptId, type ScanEventInput } from "@/lib/scanTracking";
import { isDeveloper } from "@/lib/features";

// GET /api/scan: is the receipt scanner reachable right now?
// POST /api/scan: one image as the raw request body; returns its text.
// POST /api/scan?debug=1, for developers only (DEVELOPER_EMAILS): also the
// scanner's full result, for the scan inspector at /dev/scan.
// POST /api/scan?order=1: the image is a quick-commerce order screenshot, so
// struck-out original prices are left out of the text.
// The scanner is a Docling service on the owner's laptop (docling-service/),
// so it can be off: the client checks first and says so plainly.

// A scan takes 10 to 30 seconds on the laptop; the client gives up at 55.
export const maxDuration = 60;

// Vercel caps request bodies at 4.5 MB; the client re-encodes images below this.
const MAX_BYTES = 4 * 1024 * 1024;

const noStore = { "Cache-Control": "no-store" };

// Anyone with a Google account can sign in, and every scan runs on the
// owner's laptop and uses the tunnel's monthly allowance, so each user gets
// a modest budget. Per server instance: it slows one account down, it is
// not a hard quota.
const SCANS_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60_000;
const recentScans = new Map<string, number[]>();

function overBudget(user: string): boolean {
  const now = Date.now();
  const times = (recentScans.get(user) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= SCANS_PER_WINDOW) {
    recentScans.set(user, times);
    return true;
  }
  times.push(now);
  recentScans.set(user, times);
  return false;
}

// Only the image types the scan screen sends: the scanner can also read
// PDFs, but nothing here needs them, and every format it parses is attack
// surface on the laptop.
function isImage(head: Uint8Array): boolean {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => head[at + i] === b);
  return (
    starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    starts([0xff, 0xd8, 0xff]) || // JPEG
    (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) // WebP
  );
}

export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const t0 = Date.now();
  const status = await scannerStatus();
  // The scanner screen opening is one step of an attempt (the inspector sends no attempt id, so is not counted).
  const attempt = new URL(req.url).searchParams.get("attempt");
  if (isAttemptId(attempt)) {
    await recordScanEvent({ attempt, event: "opened" }, email);
    await recordScanEvent(
      { attempt, event: "availability_checked", outcome: status.available ? "up" : "down", detail: status.why, ms: Date.now() - t0 },
      email,
    );
  }
  return NextResponse.json({ available: status.available }, { headers: noStore });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const debug = params.get("debug") === "1" && (await isDeveloper(email));
  // One image of an attempt: counted by its place in the attempt. A developer's
  // inspector scans are tracked as test traffic, which the metrics leave out.
  const attemptParam = params.get("attempt");
  const attempt = isAttemptId(attemptParam) ? attemptParam : debug ? crypto.randomUUID() : null;
  const seq = Number(params.get("n") ?? 1);
  const track = (e: Omit<ScanEventInput, "attempt" | "seq" | "test">) =>
    attempt ? recordScanEvent({ attempt, seq: Number.isInteger(seq) && seq > 0 ? seq : undefined, test: debug, ...e }, email) : Promise.resolve();
  const refuse = async (error: string, status: number, outcome: string, headers?: Record<string, string>) => {
    await track({ event: "scan_requested" });
    await track({ event: "scan_result", outcome });
    return NextResponse.json({ error }, { status, headers });
  };

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return refuse("too-large", 413, "too-large");
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.length === 0) return refuse("empty", 400, "empty");
  if (data.length > MAX_BYTES) return refuse("too-large", 413, "too-large");
  if (!isImage(data)) return refuse("unsupported", 415, "unsupported", noStore);
  if (overBudget(email)) return refuse("rate-limited", 429, "rate-limited", noStore);

  await track({ event: "scan_requested", n: data.length });
  const t0 = Date.now();
  const out = await scanFile(data, { order: params.get("order") === "1" });
  await track(
    out.ok
      ? { event: "scan_result", outcome: "ok", ms: Date.now() - t0 }
      : { event: "scan_result", outcome: out.reason === "unavailable" ? "down" : out.reason, detail: out.why, ms: Date.now() - t0 },
  );
  if (out.ok)
    return NextResponse.json(
      // rows: each line with its height on the page, so screenshots of one
      // long order can be put in order and their overlaps found.
      { text: out.lines.join("\n"), rows: out.rows, ...(debug ? { debug: out.result } : {}) },
      { headers: noStore },
    );
  const status = { unavailable: 503, unsupported: 415, "too-large": 413, "no-text": 422 }[out.reason];
  return NextResponse.json({ error: out.reason }, { status, headers: noStore });
}
