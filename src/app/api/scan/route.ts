import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { scanFile, scannerAvailable } from "@/lib/scanner/client";
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

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ available: await scannerAvailable() }, { headers: noStore });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const debug = params.get("debug") === "1" && (await isDeveloper(email));

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES)
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.length === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (data.length > MAX_BYTES) return NextResponse.json({ error: "too-large" }, { status: 413 });
  if (!isImage(data)) return NextResponse.json({ error: "unsupported" }, { status: 415, headers: noStore });
  if (overBudget(email)) return NextResponse.json({ error: "rate-limited" }, { status: 429, headers: noStore });

  const out = await scanFile(data, { order: params.get("order") === "1" });
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
