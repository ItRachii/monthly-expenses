import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserGroups, isGroupMember } from "@/lib/groups";

// GET /api/ctx-version?ctx=<personal|groupId>
// A cheap fingerprint of a context's data for the group screen's polling:
// it changes whenever an expense is added, edited or deleted (the
// expense_changes CDC log) or a settlement is recorded. The client only asks
// the server to re-render when this value moves.
export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const ctx = new URL(req.url).searchParams.get("ctx") || "personal";
  const personal = ctx === "personal";
  if (!personal && !(await isGroupMember(ctx, email)))
    return NextResponse.json({ error: "Not a member." }, { status: 403 });

  const key = personal ? "owner_email" : "group_id";
  const value = personal ? email : ctx;
  // Personal savings include your share of every group's expenses, so the
  // personal screen also refreshes when any of your groups changes.
  const groupIds = personal ? (await getUserGroups(email)).map((g) => g.id) : [];

  let changes: string;
  try {
    const rows = await prisma.$queryRaw<{ v: bigint | null }[]>`
      SELECT max(id) AS v FROM public.expense_changes
      WHERE coalesce(new_data, old_data) ->> ${key} = ${value}
         OR coalesce(new_data, old_data) ->> 'group_id' = ANY(${groupIds})`;
    changes = String(rows[0]?.v ?? 0);
  } catch {
    // No CDC table (e.g. a fresh local database): fall back to the rows
    // themselves, which still catches additions and deletions.
    const agg = await prisma.expense.aggregate({
      where: personal
        ? { OR: [{ ownerEmail: email }, { groupId: { in: groupIds } }] }
        : { groupId: ctx },
      _count: true,
      _max: { id: true },
      _sum: { amount: true },
    });
    changes = `${agg._count}.${agg._max.id ?? 0}.${agg._sum.amount ?? 0}`;
  }
  const st = await prisma.settlement.aggregate({
    where: personal ? { ownerEmail: email } : { groupId: ctx },
    _count: true,
    _max: { id: true },
  });

  // Income edits move the personal savings figure too.
  const income = personal
    ? await prisma.userIncome.aggregate({ where: { userEmail: email }, _max: { updatedAt: true } })
    : null;
  const incomeVersion = income?._max.updatedAt?.getTime() ?? 0;

  return NextResponse.json(
    { version: `${changes}:${st._count}:${st._max.id ?? 0}:${incomeVersion}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
