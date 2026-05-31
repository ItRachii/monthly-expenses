import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { ContextSelector } from "@/components/ContextSelector";
import { CATEGORIES, PEOPLE, SPLIT_OPTIONS } from "@/lib/constants";
import { AddExpenseForm } from "./AddExpenseForm";

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctxParam = typeof sp.ctx === "string" ? sp.ctx : undefined;
  const r = await resolveContext(user.email, ctxParam);

  let payerOptions: { value: string; label: string }[];
  let splitOptions: { value: string; label: string }[];
  let currentRole: string | null = null;

  if (r.isPersonal) {
    currentRole = user.appUser?.systemRole ?? "Person A";
    payerOptions = PEOPLE.map((p) => ({ value: p, label: r.nameMap[p] ?? p }));
    splitOptions = SPLIT_OPTIONS.map((s) => ({ value: s, label: r.nameMap[s] ?? s }));
  } else {
    payerOptions = r.members.map((m) => ({ value: m.email, label: m.displayName }));
    splitOptions = [
      { value: "equal", label: "Equal Split" },
      ...r.members.map((m) => ({ value: m.email, label: m.displayName })),
    ];
  }

  return (
    <div className="space-y-6">
      <h1>Add Expense</h1>
      <ContextSelector label="Add expense to:" options={r.options} current={r.ctxValue} />

      {r.error ? (
        <div className="alert-error">{r.error}</div>
      ) : (
        <AddExpenseForm
          ctx={r.ctxValue}
          isPersonal={r.isPersonal}
          categories={[...CATEGORIES]}
          payerOptions={payerOptions}
          splitOptions={splitOptions}
          currentRole={currentRole}
          memberCount={r.members.length}
        />
      )}
    </div>
  );
}
