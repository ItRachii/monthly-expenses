import { ArrowLeftIcon } from "@/components/Icons";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getExpenses, getUsedCategories } from "@/lib/expenses";
import { getSettlements } from "@/lib/settlements";
import { maskExpenses, maskSettlements } from "@/lib/wire";
import { getOutstandingAllMonths, linesForUser } from "@/lib/balances";
import { SPLIT_CUSTOM, SPLIT_EQUAL, mergeCategories } from "@/lib/constants";
import { getUserGroups, touchGroupVisit } from "@/lib/groups";
import { buildGroupView, type GroupView } from "@/lib/groupView";
import { getGroupSharesByMonth, getIncomeHistory } from "@/lib/income";
import { monthKey } from "@/lib/format";
import { listCards } from "@/lib/cards";
import { listLoans } from "@/lib/loans";
import { statementsEnabled } from "@/lib/features";
import { openNotification } from "@/lib/notifications";
import { savingsByMonth } from "@/lib/incomeMath";
import type { FinanceData } from "@/components/PersonalFinance";
import { SpaceView, type SpaceTab } from "./SpaceView";

// One screen per context ("personal" or a group id): hero + Expenses /
// Balances / Summary tabs. Replaces the separate /log, /settlement and
// /summary pages.
export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ ctx: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const ctxParam = decodeURIComponent(ctx);
  const r = await resolveContext(user.email, ctxParam);

  if (r.error) {
    return (
      <div className="space-y-4">
        <div className="alert-error">{r.error}</div>
        <Link href="/" className="btn-secondary">
          <ArrowLeftIcon className="h-4 w-4" /> Back to home
        </Link>
      </div>
    );
  }

  const [rowsRaw, settlementsRaw, usedCategories, incomeData, , cards, loans] = await Promise.all([
    getExpenses(r.context, "desc"),
    getSettlements(r.context),
    getUsedCategories(r.context),
    // Personal only: income and your share of group spending, for savings.
    r.isPersonal
      ? Promise.all([getIncomeHistory(user.email), getGroupSharesByMonth(user.email)])
      : Promise.resolve(null),
    // Feeds the sidebar's recent groups.
    r.isPersonal ? Promise.resolve() : touchGroupVisit(user.email, r.ctxValue),
    // Cards are filed under the user's account, so only Personal shows them.
    r.isPersonal && statementsEnabled() ? listCards(user.email) : Promise.resolve(null),
    r.isPersonal && statementsEnabled() ? listLoans(user.email) : Promise.resolve([]),
  ]);
  // The income never reaches the browser: only whether it is set and what
  // was saved each month as a percent of it.
  let finance: FinanceData | null = null;
  if (incomeData) {
    const [incomeHistory, groupShares] = incomeData;
    const currentMonth = monthKey(new Date());
    const months = [...new Set([...rowsRaw.map((x) => x.date.slice(0, 7)), ...Object.keys(groupShares), currentMonth])];
    finance = {
      groupShares,
      currentMonth,
      incomeSet: incomeHistory.length > 0,
      savingsPct: savingsByMonth(incomeHistory, rowsRaw, groupShares, months),
    };
  }
  const rows = maskExpenses(rowsRaw, r.wire);
  const settlements = maskSettlements(settlementsRaw, r.wire);
  const categories = mergeCategories(usedCategories);

  const payerOptions = r.wire.members.map((m) => ({ value: m.key, label: m.displayName }));
  const splitOptions = [
    { value: SPLIT_EQUAL, label: "Equal Split" },
    { value: SPLIT_CUSTOM, label: "Unequal split" },
    ...r.wire.members.map((m) => ({ value: m.key, label: m.displayName })),
  ];

  // All-months outstanding balance for the hero (groups only).
  let heroNet = 0;
  let heroLines: ReturnType<typeof linesForUser>["lines"] = [];
  // Feeds the settings overlay behind the gear icon (groups only).
  let settings: GroupView | null = null;
  if (!r.isPersonal) {
    const [transfers, groups] = await Promise.all([
      getOutstandingAllMonths(
        r.ctxValue,
        r.members.map((m) => m.email),
      ),
      getUserGroups(user.email),
    ]);
    const rel = linesForUser(transfers, user.email, r.wire);
    heroNet = rel.net;
    heroLines = rel.lines;
    const group = groups.find((g) => g.id === r.ctxValue);
    if (group) settings = await buildGroupView(group, user.email);
  }

  const name = r.isPersonal
    ? "Personal expenses"
    : r.options.find((o) => o.value === r.ctxValue)?.label ?? "Group";
  const selfKey = r.isPersonal
    ? "me"
    : r.wire.members.find((m) => m.isSelf)?.key ?? "";
  // Opened from a notification: land on the record it is about.
  const nParam = typeof sp.n === "string" && /^\d{1,9}$/.test(sp.n) ? Number(sp.n) : null;
  const focus = nParam !== null && !r.isPersonal ? await openNotification(user.email, nParam, r.ctxValue) : null;
  const tabParam = focus ? (focus.target.kind === "settlement" ? "balances" : "expenses") : typeof sp.tab === "string" ? sp.tab : "expenses";
  const initialTab = (["expenses", "statements", "balances", "summary"].includes(tabParam)
    ? tabParam
    : "expenses") as SpaceTab;

  return (
    <SpaceView
      // A new notification remounts the view, so it lands on the new record.
      key={focus ? `n${focus.id}` : "view"}
      ctx={r.ctxValue}
      name={name}
      isPersonal={r.isPersonal}
      memberCount={r.wire.members.length}
      heroNet={heroNet}
      heroLines={heroLines}
      initialTab={initialTab}
      focus={focus}
      rows={rows}
      settlements={settlements}
      nameMap={r.wire.nameMap}
      imageMap={r.wire.imageMap}
      members={r.wire.members.map((m) => ({ key: m.key, displayName: m.displayName }))}
      categories={categories}
      payerOptions={payerOptions}
      splitOptions={splitOptions}
      selfKey={selfKey}
      settings={settings}
      finance={finance}
      cards={cards}
      loans={loans}
    />
  );
}
