import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveContext } from "@/lib/resolveContext";
import { getExpenses } from "@/lib/expenses";
import { getSettlements } from "@/lib/settlements";
import { getAppUser, displayNameFor } from "@/lib/users";
import { buildWorkbook } from "@/lib/export";
import { isValidDateISO } from "@/lib/validate";
import { labelForUnknown } from "@/lib/pii";

// GET /api/export?ctx=<personal|groupId>&from=YYYY-MM-DD&to=YYYY-MM-DD
// Omit from/to for the full history. Streams an .xlsx: Summary sheet first,
// then one sheet per month.
export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const ctxParam = url.searchParams.get("ctx") ?? "personal";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const ranged = Boolean(from || to);
  if (ranged && (!isValidDateISO(from) || !isValidDateISO(to) || from > to))
    return NextResponse.json({ error: "Invalid date range." }, { status: 400 });

  const r = await resolveContext(email, ctxParam);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 403 });

  const [allExpenses, allSettlements] = await Promise.all([
    getExpenses(r.context, "asc"),
    getSettlements(r.context),
  ]);
  const expenses = ranged
    ? allExpenses.filter((e) => e.date >= from && e.date <= to)
    : allExpenses;
  const months = new Set(expenses.map((e) => e.date.slice(0, 7)));
  const settlements = ranged
    ? allSettlements.filter((s) => months.has(s.month))
    : allSettlements;

  const memberNames = new Map<string, string>();
  let title: string;
  if (r.isPersonal) {
    const me = await getAppUser(email);
    memberNames.set(email, displayNameFor(me, "You"));
    title = "Personal expenses";
  } else {
    for (const m of r.members) memberNames.set(m.email, m.displayName);
    title = r.options.find((o) => o.value === r.ctxValue)?.label ?? "Group";
  }
  // People who left the group still appear on old rows: masked, never raw.
  const nameFor = (e: string) => memberNames.get(e) ?? labelForUnknown(e);

  const buffer = await buildWorkbook({
    title,
    isPersonal: r.isPersonal,
    memberNames,
    nameFor,
    expenses,
    settlements,
    range: ranged ? { from, to } : null,
    exportedAt: new Date(),
  });

  const slug = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "export";
  const suffix = ranged ? `${from}_to_${to}` : "full-history";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}_${suffix}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
