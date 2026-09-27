import { GroupsIcon, ProfileIcon } from "@/components/NavIcons";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getUserGroups } from "@/lib/groups";
import { wireKey } from "@/lib/wire";
import { SPLIT_EQUAL } from "@/lib/constants";
import { buildAddSetup } from "@/lib/addSetup";
import { AddExpenseForm } from "./AddExpenseForm";
import { ReceiptScanner } from "./ReceiptScanner";

// Two-step Splitwise-style flow: first pick WHERE the expense goes (Personal
// or a group), then fill the form scoped to that choice.
export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctxParam = typeof sp.ctx === "string" ? sp.ctx : undefined;

  // Step 1 — no destination chosen yet: show the chooser.
  if (!ctxParam) {
    const groups = await getUserGroups(user.email);
    return (
      <div className="space-y-6">
        <h1>Add Expense</h1>
        <p className="text-sm text-muted">Where should this expense go?</p>
        <div className="space-y-2">
          <Link
            href="/add?ctx=personal"
            className="card flex items-center gap-3 transition hover:border-white/20 hover:bg-white/5"
          >
            <span aria-hidden className="text-2xl leading-none">
              <ProfileIcon />
            </span>
            <span>
              <span className="block font-semibold">Personal</span>
              <span className="block text-xs text-muted">Just your own ledger</span>
            </span>
          </Link>
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/add?ctx=${encodeURIComponent(g.id)}`}
              className="card flex items-center gap-3 transition hover:border-white/20 hover:bg-white/5"
            >
              <span aria-hidden className="text-2xl leading-none">
                <GroupsIcon />
              </span>
              <span>
                <span className="block font-semibold">{g.name}</span>
                <span className="block text-xs text-muted">
                  Split with the group
                </span>
              </span>
            </Link>
          ))}
        </div>
        <p className="text-xs text-muted">
          Need a new group?{" "}
          <Link href="/groups" className="underline">
            Create one here
          </Link>
          .
        </p>
      </div>
    );
  }

  // Step 2 — destination chosen: the form, scoped to it.
  const res = await buildAddSetup(user.email, ctxParam);
  const setup = "setup" in res ? res.setup : null;
  const destination = setup?.name ?? "Personal";

  return (
    <div className="space-y-6">
      <h1>Add Expense</h1>
      <p className="text-sm">
        Adding to <strong>{destination}</strong>{" "}
        <Link href="/add" className="text-muted underline">
          (change)
        </Link>
      </p>

      {!setup ? (
        <div className="alert-error">{"error" in res ? res.error : "Something went wrong."}</div>
      ) : (
        <>
          <ReceiptScanner
            ctx={setup.ctx}
            isPersonal={setup.isPersonal}
            categories={setup.categories}
            payerOptions={setup.payerOptions}
            splitOptions={setup.splitOptions}
            defaultPayer={setup.defaultPayer}
          />
          <AddExpenseForm
            ctx={setup.ctx}
            isPersonal={setup.isPersonal}
            categories={setup.categories}
            payerOptions={setup.payerOptions}
            splitOptions={setup.splitOptions}
            defaultPayer={setup.defaultPayer}
            defaultSplit={SPLIT_EQUAL}
            memberCount={setup.memberCount}
            offlineOwner={wireKey("offline-owner", user.email)}
          />
        </>
      )}
    </div>
  );
}
