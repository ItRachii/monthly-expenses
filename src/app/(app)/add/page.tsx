import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getUsedCategories } from "@/lib/expenses";
import { wireKey } from "@/lib/wire";
import { ContextSelector } from "@/components/ContextSelector";
import { SPLIT_EQUAL, mergeCategories } from "@/lib/constants";
import { AddExpenseForm } from "./AddExpenseForm";
import { ReceiptScanner } from "./ReceiptScanner";

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctxParam = typeof sp.ctx === "string" ? sp.ctx : undefined;
  const r = await resolveContext(user.email, ctxParam);
  // Standard categories plus any the user already created in this context.
  const categories = mergeCategories(r.error ? [] : await getUsedCategories(r.context));

  // Group: payer = participants (value=opaque key, label=nickname); split =
  // Equal + participants. Raw emails stay on the server; the action resolves
  // keys. Personal is solo, so the form hides these and the server forces them.
  const payerOptions = r.wire.members.map((m) => ({ value: m.key, label: m.displayName }));
  const splitOptions = [
    { value: SPLIT_EQUAL, label: "Equal Split" },
    ...r.wire.members.map((m) => ({ value: m.key, label: m.displayName })),
  ];

  // Default payer is the logged-in user when they are a member, else first member.
  const defaultPayer =
    r.wire.members.find((m) => m.isSelf)?.key ?? payerOptions[0]?.value ?? "";

  return (
    <div className="space-y-6">
      <h1>Add Expense</h1>
      <ContextSelector label="Add expense to:" options={r.options} current={r.ctxValue} />

      {r.error ? (
        <div className="alert-error">{r.error}</div>
      ) : (
        <>
          <ReceiptScanner
            ctx={r.ctxValue}
            isPersonal={r.isPersonal}
            categories={categories}
            payerOptions={payerOptions}
            splitOptions={splitOptions}
            defaultPayer={defaultPayer}
          />
          <AddExpenseForm
            ctx={r.ctxValue}
            isPersonal={r.isPersonal}
            categories={categories}
            payerOptions={payerOptions}
            splitOptions={splitOptions}
            defaultPayer={defaultPayer}
            defaultSplit={SPLIT_EQUAL}
            memberCount={r.wire.members.length}
            offlineOwner={wireKey("offline-owner", user.email)}
          />
        </>
      )}
    </div>
  );
}
