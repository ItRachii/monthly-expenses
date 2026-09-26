import { NAV_ICONS } from "@/components/NavIcons";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { resolveContext } from "@/lib/resolveContext";
import { getUserGroups } from "@/lib/groups";
import { getUsedCategories } from "@/lib/expenses";
import { wireKey } from "@/lib/wire";
import { SPLIT_EQUAL, mergeCategories } from "@/lib/constants";
import { AddExpenseForm } from "./AddExpenseForm";
import { ReceiptScanner } from "./ReceiptScanner";

// Two-step Splitwise-style flow: first pick WHERE the expense goes (Personal
// or a group), then fill the form scoped to that choice.
const ProfileIcon = NAV_ICONS["/profile"];
const GroupsIcon = NAV_ICONS["/groups"];

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
  const r = await resolveContext(user.email, ctxParam);
  const categories = mergeCategories(r.error ? [] : await getUsedCategories(r.context));

  const payerOptions = r.wire.members.map((m) => ({ value: m.key, label: m.displayName }));
  const splitOptions = [
    { value: SPLIT_EQUAL, label: "Equal Split" },
    ...r.wire.members.map((m) => ({ value: m.key, label: m.displayName })),
  ];
  const defaultPayer =
    r.wire.members.find((m) => m.isSelf)?.key ?? payerOptions[0]?.value ?? "";
  const destination = r.isPersonal
    ? "Personal"
    : r.options.find((o) => o.value === r.ctxValue)?.label ?? "Group";

  return (
    <div className="space-y-6">
      <h1>Add Expense</h1>
      <p className="text-sm">
        Adding to <strong>{destination}</strong>{" "}
        <Link href="/add" className="text-muted underline">
          (change)
        </Link>
      </p>

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
