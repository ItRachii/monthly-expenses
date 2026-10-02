// Unit checks for where opening a notification lands (no database). Run
// with `npm run test:landing`.
import { ALL_MONTHS, landingFor, placeGhosts, settlementLanding } from "../../src/lib/landing";
import { notificationHref, parseTarget, type NotificationFocus } from "../../src/lib/notifications";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const rows = [
  { id: 5, date: "2026-09-20" },
  { id: 4, date: "2026-09-02" },
  { id: 3, date: "2026-08-15" },
  { id: 2, date: "2026-07-01" },
];
const focus = (type: string, target: NotificationFocus["target"]): NotificationFocus => ({ id: 1, type, target });

// Added: an older month opens on that month.
const added = landingFor(focus("expense_added", { kind: "expenses", ids: [3] }), rows);
check("added: older month", same(added, { kind: "expenses", verb: "added", ids: [3], missing: 0, month: "2026-08" }), JSON.stringify(added));
// Edited reads as edited.
const edited = landingFor(focus("expense_updated", { kind: "expenses", ids: [5] }), rows);
check("edited: verb", edited?.kind === "expenses" && edited.verb === "edited" && edited.month === "2026-09");
// A receipt or import across months opens All months.
const spread = landingFor(focus("expense_added", { kind: "expenses", ids: [5, 3] }), rows);
check("spans months: All", spread?.kind === "expenses" && spread.month === ALL_MONTHS);
// Deleted since: nothing to highlight, the month is left alone.
const gone = landingFor(focus("expense_added", { kind: "expenses", ids: [99] }), rows);
check("deleted since", same(gone, { kind: "expenses", verb: "added", ids: [], missing: 1, month: null }), JSON.stringify(gone));
// Partly deleted since.
const part = landingFor(focus("expense_added", { kind: "expenses", ids: [4, 98, 99] }), rows);
check("partly deleted since", part?.kind === "expenses" && same(part.ids, [4]) && part.missing === 2 && part.month === "2026-09");
// A deleted expense opens on its month, with its snapshot.
const ghost = { date: "2026-08-10", item: "Rent", category: "Housing", amount: 1200 };
const del = landingFor(focus("expense_deleted", { kind: "deleted", items: [ghost], count: 1, total: 1200 }), rows);
check("deleted: its month", del?.kind === "deleted" && del.month === "2026-08" && del.ghosts.length === 1);
// A bulk removal has no snapshot: nothing to place, the month is left alone.
const bulk = landingFor(focus("expense_deleted", { kind: "deleted", items: [], count: 12, total: 9000 }), rows);
check("bulk deleted: no month", bulk?.kind === "deleted" && bulk.month === null && bulk.count === 12);
// Payments are not the feed's business.
check("settlement: not the feed", landingFor(focus("settlement_recorded", { kind: "settlement", id: 7, month: "2026-08" }), rows) === null);
check("no focus", landingFor(null, rows) === null);

// Ghosts slot in by date, after rows of the same day.
const list = [{ date: "2026-08-20" }, { date: "2026-08-10" }, { date: "2026-08-01" }];
const placed = placeGhosts(list, [{ date: "2026-08-10", ghost: true }], "desc");
check("ghost: desc by date", placed.map((p) => (p.ghost ? "G" : p.row!.date.slice(8))).join(",") === "20,10,G,01");
const asc = placeGhosts([...list].reverse(), [{ date: "2026-08-15" }], "asc");
check("ghost: asc by date", asc.map((p) => (p.ghost ? "G" : p.row!.date.slice(8))).join(",") === "01,10,G,20");
const top = placeGhosts(list, [{ date: "2026-08-15" }], null);
check("ghost: other sorts on top", top[0].ghost !== undefined && top.length === 4);
const last = placeGhosts(list, [{ date: "2026-07-01" }], "desc");
check("ghost: oldest goes last", last[3].ghost !== undefined);
check("ghost: empty list", placeGhosts([], [{ date: "2026-08-15" }], "desc").length === 1);

// Payments.
const pay = settlementLanding(focus("settlement_recorded", { kind: "settlement", id: 7, month: "2026-08" }), [6, 7]);
check("payment: present", same(pay, { id: 7, month: "2026-08", present: true }));
const payGone = settlementLanding(focus("settlement_recorded", { kind: "settlement", id: 9, month: "2026-08" }), [6, 7]);
check("payment: gone", payGone?.present === false);

// Stored targets are validated on the way back.
check("parse: expenses", same(parseTarget({ kind: "expenses", ids: [1, 2] }), { kind: "expenses", ids: [1, 2] }));
check("parse: empty ids rejected", parseTarget({ kind: "expenses", ids: [] }) === null);
check("parse: bad ids rejected", parseTarget({ kind: "expenses", ids: ["1"] }) === null);
check("parse: bad snapshot dropped", parseTarget({ kind: "deleted", items: [ghost, { item: "x" }], count: 2, total: 5 })?.kind === "deleted");
const dropped = parseTarget({ kind: "deleted", items: [ghost, { item: "x" }], count: 2, total: 5 });
check("parse: only good snapshots kept", dropped?.kind === "deleted" && dropped.items.length === 1);
check("parse: settlement month checked", parseTarget({ kind: "settlement", id: 3, month: "Aug" }) === null);
check("parse: null", parseTarget(null) === null && parseTarget("x") === null);

// Links.
check("href: old notification opens the group", notificationHref({ id: 3, groupId: "g-1", target: null }) === "/g/g-1");
check("href: expense", notificationHref({ id: 3, groupId: "g 1", target: { kind: "expenses", ids: [1] } }) === "/g/g%201?tab=expenses&n=3");
check("href: payment", notificationHref({ id: 4, groupId: "g", target: { kind: "settlement", id: 1, month: "2026-08" } }) === "/g/g?tab=balances&n=4");

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
