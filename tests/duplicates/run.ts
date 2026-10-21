// Unit checks for spotting statement rows that are already expenses (no
// database). Run with `npm run test:duplicates`.
import { matchDuplicates, normalizeItem, occurrences, type ExistingExpense, type IncomingRow } from "../../src/lib/statements/duplicates";
import { importKeyFor } from "../../src/lib/statementDuplicates";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const asObj = (m: Map<number, { id: number; how: string }>) => Object.fromEntries(m);

// Occurrences: two identical coffees on one day are rows 1 and 2.
const occ = occurrences([
  { date: "2026-09-03", total: 200, description: "CAFE COFFEE DAY" },
  { date: "2026-09-03", total: 200, description: "Cafe  Coffee Day." },
  { date: "2026-09-03", total: 250, description: "CAFE COFFEE DAY" },
  { date: "2026-09-04", total: 200, description: "CAFE COFFEE DAY" },
]);
check("occurrences", same(occ, [1, 2, 1, 1]), occ.join(","));
check("normalize", normalizeItem("  SWIGGY*Bangalore. ") === "swiggy bangalore");

// Keys: stable, and distinct per row, card, user and occurrence.
const card = { bank: "hdfc", last4: "1234" };
const row = { date: "2026-09-03", amount: 200, item: "CAFE COFFEE DAY", occurrence: 1 };
const k = importKeyFor("u_a", card, row);
check("key: stable", k === importKeyFor("u_a", card, { ...row }) && /^i_[A-Za-z0-9_-]{32}$/.test(k), k);
check("key: same text differently spaced", k === importKeyFor("u_a", card, { ...row, item: "Cafe  coffee day." }));
check("key: occurrence", k !== importKeyFor("u_a", card, { ...row, occurrence: 2 }));
check("key: card", k !== importKeyFor("u_a", { bank: "hdfc", last4: "9999" }, row));
check("key: user", k !== importKeyFor("u_b", card, row));
check("key: amount", k !== importKeyFor("u_a", card, { ...row, amount: 200.01 }));
check("key: no readable text", !k.toLowerCase().includes("cafe") && !k.includes("1234"));

const inc = (index: number, date: string, amount: number, item: string, key: string): IncomingRow => ({ index, date, amount, item, key });
const ex = (id: number, date: string, amount: number, item: string, importKey: string | null, cardId: string | null = null): ExistingExpense => ({ id, date, amount, item, importKey, cardId });

// Same statement read twice: exact, by key, even after the expense was renamed.
let m = matchDuplicates([inc(0, "2026-09-03", 200, "CAFE COFFEE DAY", "K1")], [ex(10, "2026-09-03", 200, "Coffee with team", "K1")], null);
check("exact by key, renamed since", same(asObj(m), { 0: { id: 10, how: "exact" } }));
// Two identical coffees: one to one, never both onto one expense.
m = matchDuplicates(
  [inc(0, "2026-09-03", 200, "CAFE", "K1"), inc(1, "2026-09-03", 200, "CAFE", "K2")],
  [ex(10, "2026-09-03", 200, "CAFE", "K1"), ex(11, "2026-09-03", 200, "CAFE", "K2")],
  null,
);
check("two coffees: one each", same(asObj(m), { 0: { id: 10, how: "exact" }, 1: { id: 11, how: "exact" } }));
// Only one coffee on record: the second is new.
m = matchDuplicates([inc(0, "2026-09-03", 200, "CAFE", "K1"), inc(1, "2026-09-03", 200, "CAFE", "K2")], [ex(10, "2026-09-03", 200, "CAFE", "K1")], null);
check("second coffee is new", same(asObj(m), { 0: { id: 10, how: "exact" } }));
// Imported before keys existed: same day, amount and description.
m = matchDuplicates([inc(0, "2026-09-03", 200, "CAFE COFFEE DAY", "K1")], [ex(10, "2026-09-03", 200, "cafe coffee day", null)], null);
check("legacy: same description", same(asObj(m), { 0: { id: 10, how: "likely" } }));
// Read as another file type (description differs) but linked to the same card.
m = matchDuplicates([inc(0, "2026-08-22", 34.74, "IGST-VPS RATE 18.0", "K9")], [ex(529, "2026-08-22", 34.74, "GST on EMI #1 interest", "KX", "card-1")], "card-1");
check("same card, day, amount", same(asObj(m), { 0: { id: 529, how: "likely" } }));
// Same day and amount on another card, different description: not a duplicate.
m = matchDuplicates([inc(0, "2026-08-22", 34.74, "IGST-VPS RATE 18.0", "K9")], [ex(529, "2026-08-22", 34.74, "Something else", null, "card-2")], "card-1");
check("other card: new", m.size === 0);
// Different amount or day: new.
m = matchDuplicates([inc(0, "2026-09-03", 200, "CAFE", "K1")], [ex(10, "2026-09-03", 201, "CAFE", null), ex(11, "2026-09-04", 200, "CAFE", null)], null);
check("amount or day differs: new", m.size === 0);
// Paise are compared exactly, not by float equality.
m = matchDuplicates([inc(0, "2026-09-03", 0.3, "X", "K1")], [ex(10, "2026-09-03", 0.1 + 0.2, "x", null)], null);
check("paise compared exactly", m.size === 1);
// Exact matches win over likely ones for the same expense.
m = matchDuplicates(
  [inc(0, "2026-09-03", 200, "CAFE", "KA"), inc(1, "2026-09-03", 200, "CAFE", "KB")],
  [ex(10, "2026-09-03", 200, "CAFE", "KB")],
  null,
);
check("exact claims first", same(asObj(m), { 1: { id: 10, how: "exact" } }));

// Descriptions in other scripts: "चाय" and "दूध" are different items, though
// normalizeItem keeps only a-z and 0-9 and makes both empty.
m = matchDuplicates([inc(0, "2026-09-03", 20, "चाय", "K1")], [ex(10, "2026-09-03", 20, "दूध", null)], null);
check("different items in Hindi are not a likely match", same(asObj(m), {}), JSON.stringify(asObj(m)));
m = matchDuplicates([inc(0, "2026-09-03", 20, "चाय", "K1")], [ex(10, "2026-09-03", 20, "चाय", null)], null);
check("the same Hindi item is a likely match", same(asObj(m), { 0: { id: 10, how: "likely" } }), JSON.stringify(asObj(m)));
m = matchDuplicates([inc(0, "2026-09-03", 20, "***", "K1")], [ex(10, "2026-09-03", 20, "---", null)], null);
check("two descriptions with no letters or digits are not a match", same(asObj(m), {}), JSON.stringify(asObj(m)));
m = matchDuplicates([inc(0, "2026-09-03", 20, "चाय", "K1")], [ex(10, "2026-09-03", 20, "दूध", null, "card-1")], "card-1");
check("an empty-looking description still matches by the same card", same(asObj(m), { 0: { id: 10, how: "likely" } }));

// Words that differ only in their vowel signs are different words.
for (const [a, b] of [["तेल", "ताला"], ["दाल", "दिल"], ["पानी", "पेन"]]) {
  m = matchDuplicates([inc(0, "2026-09-03", 120, a, "K1")], [ex(10, "2026-09-03", 120, b, null)], null);
  check(`"${a}" is not "${b}"`, same(asObj(m), {}), JSON.stringify(asObj(m)));
}
m = matchDuplicates([inc(0, "2026-09-03", 120, "Café", "K1")], [ex(10, "2026-09-03", 120, "Cafe\u0301", null)], null);
check("the same word in two Unicode spellings matches", same(asObj(m), { 0: { id: 10, how: "likely" } }), JSON.stringify(asObj(m)));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
