import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getUserGroups } from "@/lib/groups";
import { statementsEnabled } from "@/lib/features";
import Link from "next/link";
import { listInstalments, loanSaltFor } from "@/lib/loans";
import { StatementImport } from "./StatementImport";

// Card statement import. Behind a feature flag (see src/lib/features.ts), so
// it can be merged and tried locally without changing production.
export default async function StatementsPage() {
  if (!statementsEnabled()) notFound();
  const user = await requireUser();
  const [groups, known] = await Promise.all([getUserGroups(user.email), listInstalments(user.email)]);
  const contexts = [
    { value: "personal", label: "Personal" },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ];
  return (
    <div className="space-y-4">
      <h1>Card statements</h1>
      <p className="text-sm text-muted">
        Import a statement here. Your cards, their statements, the expenses added from them and your EMIs are under{" "}
        <Link href="/g/personal?tab=statements" className="text-primary hover:underline">
          Personal expenses, Statements
        </Link>
        .
      </p>
      <StatementImport contexts={contexts} loanSalt={loanSaltFor(user.email)} known={known} />
    </div>
  );
}
