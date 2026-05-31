import { requireUser } from "@/lib/session";
import { getPendingInvitesForUser } from "@/lib/groups";
import { PendingInvites } from "@/components/PendingInvites";

const pages = [
  ["Add Expense", "Log a new expense — date, category, amount, payer, and split"],
  ["Expense Log", "View, filter, and delete expenses; export to CSV"],
  ["Monthly Summary", "Charts and per-person breakdown for any month"],
  ["Settlement", "See the net balance and mark months as settled"],
  ["Groups", "Create groups, send invites, manage members"],
];

const splits = [
  ["50-50", "Each person is responsible for half the amount"],
  ["Person X", "That person is responsible for the full amount"],
];

export default async function HomePage() {
  const user = await requireUser();
  const pending = await getPendingInvitesForUser(user.email);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1>Monthly Expense Tracker</h1>
        <p className="text-muted">
          Track your <strong className="text-ink">personal</strong> expenses or
          collaborate in <strong className="text-ink">groups</strong>. Use the
          selector at the top of each page to switch between Personal and a Group.
        </p>
      </header>

      {pending.length > 0 ? <PendingInvites invites={pending} /> : null}

      <section className="space-y-3">
        <h2 className="section-title">Pages</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {pages.map(([title, desc]) => (
            <div key={title} className="card">
              <div className="font-semibold">{title}</div>
              <div className="mt-1 text-sm text-muted">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">Split types</h2>
        <div className="card space-y-2">
          {splits.map(([k, v]) => (
            <div key={k} className="flex gap-3 text-sm">
              <span className="pill shrink-0 font-mono">{k}</span>
              <span className="text-muted">{v}</span>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted">
            The <strong className="text-ink">Payer</strong> field records who
            physically paid. The <strong className="text-ink">Split</strong> field
            records who owes what. These are tracked independently so the balance is
            always accurate.
          </p>
        </div>
      </section>
    </div>
  );
}
