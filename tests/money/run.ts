// Unit checks for split and savings math (no database). Run with
// `npm run test:money`.
import { computeNets, paidFor, parseShares, payersOf, shareFor, simplifyDebts } from "../../src/lib/settlementMath";
import {
  REMIND_LATER_MS,
  incomeForMonth,
  incomeMonthOptions,
  incomePromptFor,
  monthFinance,
} from "../../src/lib/incomeMath";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Unequal split: A pays 900 split 100/300/500; B pays 300 split equally;
// C pays 50 that is all A's.
const rows = [
  { payer: "a", split: "custom", amount: 900, shares: { a: 100, b: 300, c: 500 } },
  { payer: "b", split: "equal", amount: 300 },
  { payer: "c", split: "a", amount: 50 },
];
const nets = computeNets(rows, ["a", "b", "c"]);
check("nets", same(nets.map((n) => n.net), [650, -100, -550]), JSON.stringify(nets));
check(
  "transfers",
  same(simplifyDebts(nets), [
    { from: "c", to: "a", amount: 550 },
    { from: "b", to: "a", amount: 100 },
  ]),
);
check("share: custom", shareFor(rows[0], "c", 3) === 500);
check("share: custom, not listed", shareFor(rows[0], "d", 3) === 0);
check("share: equal", shareFor(rows[1], "a", 3) === 100);
check("share: one person", shareFor(rows[2], "a", 3) === 50 && shareFor(rows[2], "c", 3) === 0);
check("parseShares drops junk", same(parseShares({ a: 5, b: "x", c: -1, d: 0 }), { a: 5, d: 0 }));
check("parseShares rejects non-objects", parseShares([1]) === null && parseShares(null) === null);

// Several payers: A and B put in 600 + 300 for a 900 dinner split equally
// three ways; C paid nothing. Each owes 300, so A is up 300, B even, C down 300.
const multi = { payer: "multiple", payers: { a: 600, b: 300 }, split: "equal", amount: 900 };
check("paidFor: several payers", paidFor(multi, "a") === 600 && paidFor(multi, "b") === 300 && paidFor(multi, "c") === 0);
check("paidFor: single payer", paidFor(rows[1], "b") === 300 && paidFor(rows[1], "a") === 0);
check("payersOf: several", same(payersOf(multi), ["a", "b"]));
check("payersOf: single", same(payersOf(rows[2]), ["c"]));
check("payersOf: largest first", same(payersOf({ ...multi, payers: { b: 300, a: 600 } }), ["a", "b"]));
check("payersOf: zero amounts dropped", same(payersOf({ ...multi, payers: { a: 900, b: 0 } }), ["a"]));
const multiNets = computeNets([multi], ["a", "b", "c"]);
check("nets: several payers", same(multiNets.map((n) => n.net), [300, 0, -300]), JSON.stringify(multiNets));
check("transfers: several payers", same(simplifyDebts(multiNets), [{ from: "c", to: "a", amount: 300 }]));
// Unequal split and several payers on the same row.
const both = { payer: "multiple", payers: { a: 500, c: 400 }, split: "custom", amount: 900, shares: { a: 100, b: 300, c: 500 } };
check("nets: several payers + unequal split", same(computeNets([both], ["a", "b", "c"]).map((n) => n.net), [400, -300, -100]));

// Income: first entry covers earlier months; later entries apply forward only.
const history = [
  { month: "2026-03", amount: 50000 },
  { month: "2026-07", amount: 60000 },
];
check("income: none set", incomeForMonth([], "2026-05") === null);
check("income: before first", incomeForMonth(history, "2026-01") === 50000);
check("income: between", incomeForMonth(history, "2026-06") === 50000);
check("income: from change", incomeForMonth(history, "2026-07") === 60000);
check("income: after", incomeForMonth(history, "2027-01") === 60000);
check(
  "savings",
  same(monthFinance(60000, 1000.1, 200.2), {
    income: 60000,
    personal: 1000.1,
    groups: 200.2,
    spent: 1200.3,
    savings: 58799.7,
  }),
);
check("overspent", monthFinance(100, 150, 0).savings === -50);
check("no income, no savings", monthFinance(null, 150, 0).savings === null);

// Income prompt: onboarding for new users, skippable popup for existing ones.
const now = new Date("2026-09-27T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const user = (incomePrompt: string | null, at: Date | null = null, signIn: Date | null = null) => ({
  incomePrompt,
  incomePromptAt: at,
  lastSignInAt: signIn,
});
check("prompt: has income", incomePromptFor(user("onboarding"), true, now) === "none");
check("prompt: new user", incomePromptFor(user("onboarding"), false, now) === "onboarding");
check("prompt: existing, not asked", incomePromptFor(user(null), false, now) === "popup");
check("prompt: skipped", incomePromptFor(user("skipped", ago(1e10)), false, now) === "none");
check("prompt: later, same session", incomePromptFor(user("later", ago(60_000), ago(3_600_000)), false, now) === "none");
check("prompt: later, signed in again", incomePromptFor(user("later", ago(3_600_000), ago(60_000)), false, now) === "popup");
check("prompt: later, a day on", incomePromptFor(user("later", ago(REMIND_LATER_MS), null), false, now) === "popup");
const opts = incomeMonthOptions("2026-02", 3);
check("month options", same(opts, ["2026-02", "2026-01", "2025-12", "2025-11"]), opts.join(","));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
