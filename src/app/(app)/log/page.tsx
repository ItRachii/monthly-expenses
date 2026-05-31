import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getExpenses } from "@/lib/expenses";
import { ContextSelector } from "@/components/ContextSelector";
import { CATEGORIES, PEOPLE, SPLIT_OPTIONS } from "@/lib/constants";
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

  const payerOptions = r.isPersonal
    ? PEOPLE.map((p) => ({ value: p, label: r.nameMap[p] ?? p }))
    : r.members.map((m) => ({ value: m.email, label: m.displayName }));
  const splitOptions = r.isPersonal
    ? SPLIT_OPTIONS.map((s) => ({ value: s, label: r.nameMap[s] ?? s }))
    : [
        { value: "equal", label: "Equal Split" },
        ...r.members.map((m) => ({ value: m.email, label: m.displayName })),
      ];

  return (
    <div className="space-y-6">
      <h1>Expense Log</h1>
      <ContextSelector label="View expenses for:" options={r.options} current={r.ctxValue} />
      {r.error ? <div className="alert-error">{r.error}</div> : null}
      <ExpenseLog
        rows={rows}
        isPersonal={r.isPersonal}
        nameMap={r.nameMap}
        categories={[...CATEGORIES]}
        payerOptions={payerOptions}
        splitOptions={splitOptions}
      />
    </div>
  );
}
