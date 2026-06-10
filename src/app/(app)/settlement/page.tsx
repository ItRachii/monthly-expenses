import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getExpenses } from "@/lib/expenses";
import { getSettlements } from "@/lib/settlements";
import { maskExpenses, maskSettlements } from "@/lib/wire";
import { ContextSelector } from "@/components/ContextSelector";
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
  // Mask emails into opaque member keys before anything reaches the client.
  const rows = r.error ? [] : maskExpenses(await getExpenses(r.context, "asc"), r.wire);
  const settlements = r.error
    ? []
    : maskSettlements(await getSettlements(r.context), r.wire);

  const payerOptions = r.wire.members.map((m) => ({ value: m.key, label: m.displayName }));

  return (
    <div className="space-y-6">
      <h1>Settlement</h1>
      {r.error ? <div className="alert-error">{r.error}</div> : null}
      <Settlement
        ctx={r.ctxValue}
        rows={rows}
        settlements={settlements}
        isPersonal={r.isPersonal}
        nameMap={r.wire.nameMap}
        members={r.wire.members.map((m) => ({ key: m.key, displayName: m.displayName }))}
        payerOptions={payerOptions}
        contextSelector={
          <ContextSelector
            label="Settle expenses for:"
            options={r.options}
            current={r.ctxValue}
            className="w-full"
          />
        }
      />
    </div>
  );
}
