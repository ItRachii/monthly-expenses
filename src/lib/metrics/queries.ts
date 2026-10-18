// Reads what the developer metrics page needs. Activity is rebuilt from the
// tables that already say who did what and when (the expense change log,
// receipts, statements, settlements, groups, invites, sign-ins), plus the
// days people opened the app (user_activity_days, once it exists). Only
// user ids are read, never addresses. Server-only.

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { developerIds } from "../features";
import { istDay } from "../activity";
import { computeUsage, weekOf, addDays, type Kind, type Usage, type UserDay } from "./math";

export interface Metrics {
  today: string;
  /** Developers' own use is left out unless asked for. */
  includesDevelopers: boolean;
  /** False until db/2026_10_user_activity.sql is applied: visits are then only sign-ins. */
  visitsTracked: boolean;
  totalUsers: number;
  usage: Usage;
  groups: {
    total: number;
    /** With an expense, settlement or other change in the last 30 days. */
    active: number;
    activePrevious: number;
    /** Groups with at least two members: the ones actually shared. */
    shared: number;
    avgMembers: number;
    createdMonthly: { month: string; count: number }[];
    invites: { sent: number; accepted: number; declined: number; pending: number };
  };
  /** Expenses added per week, by where they came from. */
  expensesWeekly: { week: string; manual: number; receipt: number; statement: number }[];
  /** Rupees of expenses added in the last 30 days, and the 30 before. */
  amountAdded: { value: number; previous: number };
}

// Every timestamp column is read as UTC (some are timestamp, some
// timestamptz), then bucketed into India days.
const ist = (col: string) => Prisma.raw(`((${col})::timestamptz AT TIME ZONE 'Asia/Kolkata')::date`);

function eventsSql(visitsTracked: boolean): Prisma.Sql {
  return Prisma.sql`
    SELECT new_data->>'owner_email' AS u, ${ist("changed_at")} AS d, 'expense' AS k
      FROM public.expense_changes
      WHERE operation IN ('INSERT', 'UPDATE') AND new_data->>'group_id' IS NULL
    UNION ALL
    SELECT actor_email, ${ist("created_at")},
           CASE WHEN type LIKE 'expense%' THEN 'expense' WHEN type LIKE 'settlement%' THEN 'settlement' ELSE 'group' END
      FROM public.notifications
    UNION ALL SELECT created_by, ${ist("created_at")}, 'receipt' FROM public.receipts
    UNION ALL
    SELECT c.owner_email, ${ist("s.imported_at")}, 'statement'
      FROM public.card_statements s JOIN public.cards c ON c.id = s.card_id
    UNION ALL SELECT settled_by, ${ist("settled_at")}, 'settlement' FROM public.settlements
    UNION ALL SELECT created_by, ${ist("created_at")}, 'group' FROM public.groups
    UNION ALL SELECT email, ${ist("joined_at")}, 'group' FROM public.group_members
    UNION ALL SELECT invited_by, ${ist("created_at")}, 'invite' FROM public.group_invites
    UNION ALL SELECT email, ${ist("last_sign_in_at")}, 'visit' FROM public.app_users WHERE last_sign_in_at IS NOT NULL
    ${visitsTracked ? Prisma.sql`UNION ALL SELECT user_id, day, 'visit' FROM public.user_activity_days` : Prisma.empty}`;
}

const num = (v: unknown) => Number(v ?? 0);
const dayStr = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export async function loadMetrics(opts: { includeDevelopers: boolean }): Promise<Metrics> {
  const today = istDay();
  const since = addDays(today, -400);
  const exclude = opts.includeDevelopers ? [] : Array.from(await developerIds());
  // Ids look like "u_...": anything else is not a person (or an old row).
  const people = Prisma.sql`u LIKE 'u\\_%' AND NOT (u = ANY(${exclude}::text[]))`;

  // Personal expenses carry their owner; group ones have none and always count.
  const ownedByPeople = Prisma.sql`coalesce(new_data->>'owner_email', 'u_') LIKE 'u\\_%'
    AND NOT (coalesce(new_data->>'owner_email', '') = ANY(${exclude}::text[]))`;

  const reg = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('public.user_activity_days')::text AS t`;
  const visitsTracked = !!reg[0]?.t;
  const events = eventsSql(visitsTracked);

  const [, rows, first, users, groupRows, monthly, invites, expenses, amounts] = await prisma.$transaction([
    prisma.$executeRaw`SET LOCAL TIME ZONE 'UTC'`,
    prisma.$queryRaw<{ u: string; d: Date; k: Kind }[]>`
      SELECT u, d, k FROM (${events}) e WHERE ${people} AND d >= ${since}::date GROUP BY u, d, k`,
    prisma.$queryRaw<{ u: string; d: Date }[]>`
      SELECT u, min(d) AS d FROM (${events}) e WHERE ${people} GROUP BY u`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM public.app_users WHERE email LIKE 'u\\_%' AND NOT (email = ANY(${exclude}::text[]))`,
    prisma.$queryRaw<{ total: bigint; shared: bigint; avg: number | null; active: bigint; prev: bigint }[]>`
      WITH g AS (
        SELECT gr.id, (SELECT count(*) FROM public.group_members m WHERE m.group_id = gr.id) AS members
          FROM public.groups gr WHERE gr.active = 1
      ), touched AS (
        SELECT new_data->>'group_id' AS gid, ${ist("changed_at")} AS d FROM public.expense_changes
          WHERE new_data->>'group_id' IS NOT NULL
        UNION ALL SELECT group_id, ${ist("settled_at")} FROM public.settlements WHERE group_id IS NOT NULL
        UNION ALL SELECT group_id, ${ist("created_at")} FROM public.notifications
      )
      SELECT (SELECT count(*) FROM g) AS total,
             (SELECT count(*) FROM g WHERE members >= 2) AS shared,
             (SELECT avg(members)::float FROM g) AS avg,
             (SELECT count(DISTINCT gid) FROM touched WHERE gid IN (SELECT id FROM g) AND d > ${addDays(today, -30)}::date) AS active,
             (SELECT count(DISTINCT gid) FROM touched WHERE gid IN (SELECT id FROM g)
                AND d > ${addDays(today, -60)}::date AND d <= ${addDays(today, -30)}::date) AS prev`,
    prisma.$queryRaw<{ m: string; n: bigint }[]>`
      SELECT to_char(${ist("created_at")}, 'YYYY-MM') AS m, count(*) AS n FROM public.groups
        WHERE ${ist("created_at")} > ${addDays(today, -366)}::date GROUP BY 1`,
    prisma.$queryRaw<{ status: string; n: bigint }[]>`
      SELECT status, count(*) AS n FROM public.group_invites
        WHERE ${ist("created_at")} > ${addDays(today, -90)}::date GROUP BY status`,
    prisma.$queryRaw<{ d: Date; src: string; n: bigint }[]>`
      SELECT ${ist("changed_at")} AS d,
             CASE WHEN new_data->>'receipt_id' IS NOT NULL THEN 'receipt'
                  WHEN new_data->>'statement_id' IS NOT NULL THEN 'statement' ELSE 'manual' END AS src,
             count(*) AS n
        FROM public.expense_changes
        WHERE operation = 'INSERT' AND ${ownedByPeople} AND ${ist("changed_at")} >= ${addDays(weekOf(today), -77)}::date
        GROUP BY 1, 2`,
    prisma.$queryRaw<{ cur: number | null; prev: number | null }[]>`
      SELECT sum(CASE WHEN ${ist("changed_at")} > ${addDays(today, -30)}::date THEN (new_data->>'amount')::float END) AS cur,
             sum(CASE WHEN ${ist("changed_at")} <= ${addDays(today, -30)}::date THEN (new_data->>'amount')::float END) AS prev
        FROM public.expense_changes
        WHERE operation = 'INSERT' AND ${ownedByPeople} AND ${ist("changed_at")} > ${addDays(today, -60)}::date`,
  ]);

  const userDays: UserDay[] = rows.map((r) => ({ user: r.u, day: dayStr(r.d), kind: r.k }));
  const firstSeen = new Map(first.map((r) => [r.u, dayStr(r.d)]));

  const createdMonthly: { month: string; count: number }[] = [];
  const [ty, tm] = today.split("-").map(Number);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(ty, tm - 1 - i, 1));
    const month = d.toISOString().slice(0, 7);
    createdMonthly.push({ month, count: num(monthly.find((r) => r.m === month)?.n) });
  }

  const inv = (s: string) => num(invites.find((r) => r.status === s)?.n);
  const expensesWeekly: Metrics["expensesWeekly"] = [];
  for (let i = 11; i >= 0; i--) {
    const week = addDays(weekOf(today), -7 * i);
    const inWeek = expenses.filter((r) => weekOf(dayStr(r.d)) === week);
    const of = (src: string) => inWeek.filter((r) => r.src === src).reduce((s, r) => s + num(r.n), 0);
    expensesWeekly.push({ week, manual: of("manual"), receipt: of("receipt"), statement: of("statement") });
  }

  const g = groupRows[0];
  return {
    today,
    includesDevelopers: opts.includeDevelopers,
    visitsTracked,
    totalUsers: num(users[0]?.n),
    usage: computeUsage(userDays, firstSeen, today),
    groups: {
      total: num(g?.total),
      active: num(g?.active),
      activePrevious: num(g?.prev),
      shared: num(g?.shared),
      avgMembers: g?.avg ?? 0,
      createdMonthly,
      invites: {
        sent: invites.reduce((s, r) => s + num(r.n), 0),
        accepted: inv("accepted"),
        declined: inv("declined"),
        pending: inv("pending"),
      },
    },
    expensesWeekly,
    amountAdded: { value: amounts[0]?.cur ?? 0, previous: amounts[0]?.prev ?? 0 },
  };
}
