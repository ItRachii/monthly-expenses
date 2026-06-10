import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getExpenses } from "@/lib/expenses";
import { maskExpenses } from "@/lib/wire";
import { ContextSelector } from "@/components/ContextSelector";
import { Summary } from "./Summary";

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctxParam = typeof sp.ctx === "string" ? sp.ctx : undefined;
  const r = await resolveContext(user.email, ctxParam);
  // Mask payer/split emails into opaque member keys before they hit the client.
  const rows = r.error ? [] : maskExpenses(await getExpenses(r.context, "asc"), r.wire);

  return (
    <div className="space-y-6">
      <h1>Monthly Summary</h1>
      {r.error ? <div className="alert-error">{r.error}</div> : null}
      <Summary
        rows={rows}
        isPersonal={r.isPersonal}
        nameMap={r.wire.nameMap}
        members={r.wire.members.map((m) => ({ key: m.key, displayName: m.displayName }))}
        contextSelector={
          <ContextSelector
            label="View summary for:"
            options={r.options}
            current={r.ctxValue}
            className="w-full"
          />
        }
      />
    </div>
  );
}
