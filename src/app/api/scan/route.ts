import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { scanFile, scannerAvailable } from "@/lib/scanner/client";
import { isDeveloper } from "@/lib/features";

// GET /api/scan: is the receipt scanner reachable right now?
// POST /api/scan: one image as the raw request body; returns its text.
// POST /api/scan?debug=1, for developers only (DEVELOPER_EMAILS): also the
// scanner's full result, for the scan inspector at /dev/scan.
// The scanner is a Docling service on the owner's laptop (docling-service/),
// so it can be off: the client checks first and says so plainly.

// A scan takes 10 to 30 seconds on the laptop.
export const maxDuration = 120;

// Vercel caps request bodies at 4.5 MB; the client re-encodes images below this.
const MAX_BYTES = 4 * 1024 * 1024;

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ available: await scannerAvailable() }, { headers: noStore });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const debug = new URL(req.url).searchParams.get("debug") === "1" && (await isDeveloper(email));

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES)
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.length === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (data.length > MAX_BYTES) return NextResponse.json({ error: "too-large" }, { status: 413 });

  const out = await scanFile(data);
  if (out.ok)
    return NextResponse.json(
      { text: out.lines.join("\n"), ...(debug ? { debug: out.result } : {}) },
      { headers: noStore },
    );
  const status = { unavailable: 503, unsupported: 415, "too-large": 413, "no-text": 422 }[out.reason];
  return NextResponse.json({ error: out.reason }, { status, headers: noStore });
}
