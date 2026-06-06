import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getExpenses, getRecentExpenseChanges } from "@/lib/expenses";
import { ContextSelector } from "@/components/ContextSelector";
import { CATEGORIES, SPLIT_EQUAL } from "@/lib/constants";
import { ExpenseLog } from "./ExpenseLog";

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctxParam = typeof sp.ctx === "string" ? sp.ctx : undefined;
  const r = await resolveContext(user.email, ctxParam);
  const rows = r.error ? [] : await getExpenses(r.context, "desc");
  const recentChanges = r.error
    ? []
    : await getRecentExpenseChanges(r.context, r.nameMap);

  const payerOptions = r.members.map((m) => ({ value: m.email, label: m.displayName }));
  const splitOptions = [
    { value: SPLIT_EQUAL, label: "Equal Split" },
    ...r.members.map((m) => ({ value: m.email, label: m.displayName })),
  ];

  return (
    <div className="space-y-6">
      <h1>Expense Log</h1>
      {r.error ? <div className="alert-error">{r.error}</div> : null}
      <ExpenseLog
        rows={rows}
        nameMap={r.nameMap}
        categories={[...CATEGORIES]}
        payerOptions={payerOptions}
        splitOptions={splitOptions}
        isPersonal={r.isPersonal}
        recentChanges={recentChanges}
        contextSelector={
          <ContextSelector
            label="View expenses for:"
            options={r.options}
            current={r.ctxValue}
            className="w-full"
          />
        }
      />
    </div>
  );
}
