// Unit checks for reading a quick-commerce order's bill summary, checking it
// adds up, and splitting its charges over the items (no network). Run with
// `npm run test:receipt`.
import { distribute, isBillLine, readOrderBill, reconcile } from "../../src/lib/receipt/orderBill";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

// The Instamart order: three items, a handling fee, the grand total.
const instamart = readOrderBill(
  ["2 x Sprite Zero Delivered ₹54.0", "1x [Combo] Coca-Cola Diet Coke Can 80.0", "Bill Summary", "Item Total ₹177", "Handling fee 9.0", "Delivery Fee ₹30 FREE", "You saved ₹26", "Grand Total ₹186"].join("\n"),
);
check("charges read, waived fee and savings left out", same(instamart.charges, [{ label: "Handling fee", amount: 9 }]), JSON.stringify(instamart.charges));
check("item total and grand total", instamart.itemTotal === 177 && instamart.orderTotal === 186, JSON.stringify(instamart));

const r = reconcile([54, 80, 43], [9], 186);
check("items + charges = total", r.status === "matched" && "diff" in r && r.diff === 0, JSON.stringify(r));
const shares = distribute([54, 80, 43], 9);
check("charges split by price, to the paisa", same(shares, [2.74, 4.07, 2.19]), JSON.stringify(shares));
check("shares add up exactly", sum(shares) === 9);
check("items with their shares add up to the total", sum([54, 80, 43].map((a, i) => a + shares[i])) === 186);

const short = reconcile([54, 80], [9], 186);
check("a missed item shows as a gap", short.status === "mismatch" && "diff" in short && short.diff === 43, JSON.stringify(short));
check("no total read", reconcile([54], [9], null).status === "no-total");
check("rounding within a rupee still matches", reconcile([99.5, 50], [10], 160).status === "matched");

// Blinkit style: several fees, a coupon taken off, "To Pay".
const blinkit = readOrderBill(
  ["Bill details", "Items total ₹300", "Delivery charge ₹25", "Handling charge ₹5", "Small cart fee ₹20", "Coupon discount -₹50", "Taxes (included in prices) ₹14", "To Pay ₹300"].join("\n"),
);
check(
  "fees, coupon as negative, included tax left out",
  same(blinkit.charges.map((c) => c.amount), [25, 5, 20, -50]) && blinkit.orderTotal === 300 && blinkit.itemTotal === 300,
  JSON.stringify(blinkit),
);
const b = reconcile([120, 180], blinkit.charges.map((c) => c.amount), blinkit.orderTotal);
check("charges net to zero and still match", b.status === "matched" && b.charges === 0, JSON.stringify(b));

// Overlapping screenshots repeat the summary.
const twice = readOrderBill(["Handling fee 9", "Grand Total 186", "Handling fee 9", "Grand Total 186"].join("\n"));
check("a charge seen twice counts once", twice.charges.length === 1 && twice.orderTotal === 186);

// Discount bigger than the fees: shares are negative and still exact.
const neg = distribute([100, 50, 50], -20);
check("negative split", same(neg, [-10, -5, -5]) && sum(neg) === -20, JSON.stringify(neg));
check("uneven split, exact", sum(distribute([33.33, 33.33, 33.34], 10)) === 10);
check("all-zero items split equally", same(distribute([0, 0], 5), [2.5, 2.5]));
check("nothing to split", same(distribute([], 5), []));

check("bill lines are not products", isBillLine("Handling fee") && isBillLine("Small cart fee") && isBillLine("Coupon discount") && isBillLine("Item Total"));
check("products are not bill lines", !isBillLine("Sprite Zero") && !isBillLine("Phone charger") && !isBillLine("Amul Taaza Milk 1L"));

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all receipt checks passed");
