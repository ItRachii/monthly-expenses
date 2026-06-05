import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getExpenses } from "@/lib/expenses";
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
  const rows = r.error ? [] : await getExpenses(r.context, "asc");

  return (
    <div className="space-y-6">
      <h1>Monthly Summary</h1>
      {r.error ? <div className="alert-error">{r.error}</div> : null}
      <Summary
        rows={rows}
        isPersonal={r.isPersonal}
        nameMap={r.nameMap}
        members={r.members.map((m) => ({ email: m.email, displayName: m.displayName }))}
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
