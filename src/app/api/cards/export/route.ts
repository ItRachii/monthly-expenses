import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { statementsEnabled } from "@/lib/features";
import { buildCardWorkbook } from "@/lib/cardExport";

// GET /api/cards/export?id=<cardId>[&period=YYYY-MM]
// Streams an .xlsx of the card's whole history (statements, the expenses
// imported from them, and its EMI instalments), or of one statement's.
export async function GET(req: Request) {
  if (!statementsEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const id = q.get("id") ?? "";
  const period = q.get("period") ?? undefined;
  if (period !== undefined && !/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const out = id ? await buildCardWorkbook(email, id, period) : null;
  if (!out) return NextResponse.json({ error: period ? "Statement not found." : "Card not found." }, { status: 404 });

  return new NextResponse(new Uint8Array(out.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${out.name}"`,
      "Cache-Control": "no-store",
    },
  });
}
