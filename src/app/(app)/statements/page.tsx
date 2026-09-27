import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getUserGroups } from "@/lib/groups";
import { statementsEnabled } from "@/lib/features";
import { StatementImport } from "./StatementImport";

// Card statement import. Behind a feature flag (see src/lib/features.ts), so
// it can be merged and tried locally without changing production.
export default async function StatementsPage() {
  if (!statementsEnabled()) notFound();
  const user = await requireUser();
  const groups = await getUserGroups(user.email);
  const contexts = [
    { value: "personal", label: "Personal" },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ];
  return (
    <div className="space-y-4">
      <h1>Card statements</h1>
      <StatementImport contexts={contexts} />
    </div>
  );
}
