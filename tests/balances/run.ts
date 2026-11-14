// Checks for all-time balances (no network). Run with `npm run test:balances`.
// The Balances tab, the group header, the home screen, the settle check and
// the export all read outstandingAllTime, so these numbers are what users see.
import { SPLIT_EQUAL } from "../../src/lib/constants";
import { outstandingAllTime, pairAmount, paymentLineage, totalOutstanding, type ExpenseLike, type PaymentLike } from "../../src/lib/settlementMath";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};

const two = ["me", "asha"];
const exp = (payer: string, amount: number): ExpenseLike => ({ payer, split: SPLIT_EQUAL, amount });
const pay = (from: string, to: string | null, amount: number): PaymentLike => ({ from, to, amount });

// Jan: Asha paid 200 (I owe 100). Feb: I paid 120 (she owes 60). Net: I owe 40.
const janFeb = [exp("asha", 200), exp("me", 120)];
const out = outstandingAllTime(janFeb, two, []);
check("months net into one figure", out.length === 1 && pairAmount(out, "me", "asha") === 40, JSON.stringify(out));

// A payment from before, recorded against January for the full 100, still
// counts: now Asha owes me 60 (Feb), not "settled January + 60".
const oldJan = outstandingAllTime(janFeb, two, [pay("me", "asha", 100)]);
check("old month payment counts all time", pairAmount(oldJan, "asha", "me") === 60, JSON.stringify(oldJan));

// Paying the netted 40 settles everything.
check("netted payment settles", outstandingAllTime(janFeb, two, [pay("me", "asha", 40)]).length === 0);

// Part payment leaves the rest.
check("part payment", pairAmount(outstandingAllTime(janFeb, two, [pay("me", "asha", 15)]), "me", "asha") === 25);

// Three people: the netting routes debts, and a payment along a pair the
// routing no longer uses still moves the money.
const three = ["a", "b", "c"];
const rows3 = [exp("a", 300)]; // b and c owe a 100 each
const routed = outstandingAllTime(rows3, three, [pay("b", "c", 50)]); // b paid c by mistake
check("odd-pair payment moves money", totalOutstanding(routed) === 200 && pairAmount(routed, "b", "a") === 50 && pairAmount(routed, "c", "a") === 150, JSON.stringify(routed));

// Legacy payment with no recipient: goes to the payer's largest debt.
const legacy = outstandingAllTime(rows3, three, [pay("b", null, 100)]);
check("legacy payment without recipient", pairAmount(legacy, "b", "a") === 0 && pairAmount(legacy, "c", "a") === 100, JSON.stringify(legacy));

// Nothing spent, nothing owed.
check("empty", outstandingAllTime([], two, []).length === 0);

// History progress: owed before each payment, left after.
const lin = paymentLineage(janFeb, two, [pay("me", "asha", 15), pay("me", "asha", 25)]);
check("lineage first", lin[0].owed === 40 && lin[0].paid === 15 && lin[0].remaining === 25, JSON.stringify(lin[0]));
check("lineage second", lin[1].owed === 25 && lin[1].remaining === 0, JSON.stringify(lin[1]));

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
