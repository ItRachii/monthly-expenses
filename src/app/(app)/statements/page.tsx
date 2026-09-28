import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getUserGroups } from "@/lib/groups";
import { statementsEnabled } from "@/lib/features";
import { listCards } from "@/lib/cards";
import { StatementImport } from "./StatementImport";
import { CardsPanel } from "./CardsPanel";

// Card statement import. Behind a feature flag (see src/lib/features.ts), so
// it can be merged and tried locally without changing production.
export default async function StatementsPage() {
  if (!statementsEnabled()) notFound();
  const user = await requireUser();
  const [groups, cards] = await Promise.all([getUserGroups(user.email), listCards(user.email)]);
  const contexts = [
    { value: "personal", label: "Personal" },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ];
  return (
    <div className="space-y-4">
      <h1>Card statements</h1>
      <CardsPanel cards={cards} />
      <StatementImport contexts={contexts} />
    </div>
  );
}
