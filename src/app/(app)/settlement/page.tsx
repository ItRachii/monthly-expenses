import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getExpenses } from "@/lib/expenses";
import { getSettlements } from "@/lib/settlements";
import { ContextSelector } from "@/components/ContextSelector";
import { PEOPLE } from "@/lib/constants";
import { Settlement } from "./Settlement";

export default async function SettlementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctxParam = typeof sp.ctx === "string" ? sp.ctx : undefined;
  const r = await resolveContext(user.email, ctxParam);
  const rows = r.error ? [] : await getExpenses(r.context, "asc");
  const settlements = r.error ? [] : await getSettlements(r.context);

  const payerOptions = r.isPersonal
    ? PEOPLE.map((p) => ({ value: p, label: r.nameMap[p] ?? p }))
    : r.members.map((m) => ({ value: m.email, label: m.displayName }));

  return (
    <div className="space-y-6">
      <h1>Settlement</h1>
      <ContextSelector label="Settle expenses for:" options={r.options} current={r.ctxValue} />
      {r.error ? <div className="alert-error">{r.error}</div> : null}
      <Settlement
        ctx={r.ctxValue}
        rows={rows}
        settlements={settlements}
        isPersonal={r.isPersonal}
        nameMap={r.nameMap}
        members={r.members.map((m) => ({ email: m.email, displayName: m.displayName }))}
        payerOptions={payerOptions}
      />
    </div>
  );
}
