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

  const [rowsRaw, settlementsRaw, usedCategories, finance] = await Promise.all([
    getExpenses(r.context, "desc"),
    getSettlements(r.context),
    getUsedCategories(r.context),
    // Personal only: income and your share of group spending, for savings.
    r.isPersonal
      ? Promise.all([getIncomeHistory(user.email), getGroupSharesByMonth(user.email)]).then(
          ([incomeHistory, groupShares]) => ({
            incomeHistory,
            groupShares,
            currentMonth: monthKey(new Date()),
          }),
        )
      : Promise.resolve(null),
    // Feeds the sidebar's recent groups.
    r.isPersonal ? Promise.resolve() : touchGroupVisit(user.email, r.ctxValue),
  ]);
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
  const tabParam = typeof sp.tab === "string" ? sp.tab : "expenses";
  const initialTab = (["expenses", "balances", "summary"].includes(tabParam)
    ? tabParam
    : "expenses") as SpaceTab;

  return (
    <SpaceView
      ctx={r.ctxValue}
      name={name}
      isPersonal={r.isPersonal}
      memberCount={r.wire.members.length}
      heroNet={heroNet}
      heroLines={heroLines}
      initialTab={initialTab}
      rows={rows}
      settlements={settlements}
      nameMap={r.wire.nameMap}
      members={r.wire.members.map((m) => ({ key: m.key, displayName: m.displayName }))}
      categories={categories}
      payerOptions={payerOptions}
      splitOptions={splitOptions}
      selfKey={selfKey}
      settings={settings}
      finance={finance}
    />
  );
}
