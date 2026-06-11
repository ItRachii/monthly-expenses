import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getExpenses, getUsedCategories } from "@/lib/expenses";
import { maskExpenses } from "@/lib/wire";
import { ContextSelector } from "@/components/ContextSelector";
import { SPLIT_EQUAL, mergeCategories } from "@/lib/constants";
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
  // maskExpenses swaps payer/split emails for opaque keys before the client.
  const rows = r.error ? [] : maskExpenses(await getExpenses(r.context, "desc"), r.wire);
  const categories = mergeCategories(r.error ? [] : await getUsedCategories(r.context));

  const payerOptions = r.wire.members.map((m) => ({ value: m.key, label: m.displayName }));
  const splitOptions = [
    { value: SPLIT_EQUAL, label: "Equal Split" },
    ...r.wire.members.map((m) => ({ value: m.key, label: m.displayName })),
  ];

  return (
    <div className="space-y-6">
      <h1>Expense Log</h1>
      {r.error ? <div className="alert-error">{r.error}</div> : null}
      <ExpenseLog
        rows={rows}
        nameMap={r.wire.nameMap}
        categories={categories}
        payerOptions={payerOptions}
        splitOptions={splitOptions}
        isPersonal={r.isPersonal}
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
