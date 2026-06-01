import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { ContextSelector } from "@/components/ContextSelector";
import { CATEGORIES, SPLIT_EQUAL } from "@/lib/constants";
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

  // Group: payer = members (value=email, label=nickname); split = Equal + members.
  // Personal is solo, so the form hides these and the server forces the values.
  const payerOptions = r.members.map((m) => ({ value: m.email, label: m.displayName }));
  const splitOptions = [
    { value: SPLIT_EQUAL, label: "Equal Split" },
    ...r.members.map((m) => ({ value: m.email, label: m.displayName })),
  ];

  // Default payer is the logged-in user when they are a member, else first member.
  const defaultPayer = r.members.some((m) => m.email === user.email)
    ? user.email
    : payerOptions[0]?.value ?? "";

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
          defaultPayer={defaultPayer}
          defaultSplit={SPLIT_EQUAL}
          memberCount={r.members.length}
        />
      )}
    </div>
  );
}
