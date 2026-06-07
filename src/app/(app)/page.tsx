import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getPendingInvitesForUser } from "@/lib/groups";
import { PendingInvites } from "@/components/PendingInvites";

const pages = [
  ["Add Expense", "Log a new expense — date, category, amount, payer, and split", "/add"],
  ["Expense Log", "View, filter, edit, and delete expenses; export to CSV", "/log"],
  ["Monthly Summary", "Charts and per-person breakdown for any month", "/summary"],
  ["Settlement", "See the net balance and mark months as settled", "/settlement"],
  ["Groups", "Create groups, send invites, manage members", "/groups"],
];

const splits = [
  ["Equal Split", "The amount is shared equally among all group members"],
  ["A specific person", "That member is responsible for the full amount"],
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
          {pages.map(([title, desc, href]) => (
            <Link
              key={title}
              href={href}
              className="card group transition hover:border-white/20 hover:bg-white/5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{title}</span>
                <span
                  aria-hidden
                  className="text-muted transition group-hover:translate-x-0.5 group-hover:text-ink"
                >
                  →
                </span>
              </div>
              <div className="mt-1 text-sm text-muted">{desc}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">Split types</h2>
        <div className="card space-y-3">
          {splits.map(([k, v]) => (
            <div key={k} className="flex items-start gap-3 text-sm">
              <span className="pill min-w-[8rem] shrink-0 text-center font-mono">
                {k}
              </span>
              <span className="text-muted">{v}</span>
            </div>
          ))}
          <p className="pt-1 text-xs text-muted">
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
