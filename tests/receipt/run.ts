// Unit checks for reading a quick-commerce order's bill summary, checking it
// adds up, and splitting its charges over the items (no network). Run with
// `npm run test:receipt`.
import { distribute, isBillLine, orderProducts, readOrderBill, reconcile } from "../../src/lib/receipt/orderBill";
import { parseReceipt } from "../../src/lib/receipt/parse";

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

// Swiggy Instamart: the items are boxed under "ITEM DETAILS" and the bill
// under "TOTAL ORDER BILL DETAILS", whose "Item Bill" must not become an item
// and whose "Free cash for you" is money off.
const swiggy = [
  "Instamart",
  "Completed | 4 items, ₹177",
  "3 items • Ulsoor",
  "Delivery",
  "Delivered",
  "ITEM DETAILS",
  "2 x Sprite Zero ₹54.0",
  "1 x [Combo] Coca-Cola Diet Coke Can ₹80.0",
  "1 x Eveready Carbon Zinc AAA Battery | Pack of 4 ₹72.0",
  "TOTAL ORDER BILL DETAILS",
  "Item Bill ₹206.00",
  "Delivery Fee ₹16.00",
  "Demand Surge Fee ₹35.40",
  "Handling Fee ₹11.00",
  "Free cash for you -₹75.00",
  "Offer Discount -₹16.00",
  "Grand Total ₹177.00",
  "Order ID 213456789012",
].join("\n");
const swiggyItems = parseReceipt(orderProducts(swiggy)).items.map((it) => it.amount);
check("Swiggy: only the three products are items", same(swiggyItems, [54, 80, 72]), JSON.stringify(parseReceipt(orderProducts(swiggy)).items));
const swiggyBill = readOrderBill(swiggy);
check(
  "Swiggy: fees, free cash and offer read from the bill box",
  same(swiggyBill.charges.map((c) => c.amount), [16, 35.4, 11, -75, -16]) && swiggyBill.itemTotal === 206 && swiggyBill.orderTotal === 177,
  JSON.stringify(swiggyBill),
);
const sw = reconcile(swiggyItems, swiggyBill.charges.map((c) => c.amount), swiggyBill.orderTotal);
check("Swiggy: adds up within a rupee", sw.status === "matched" && "diff" in sw && sw.diff === -0.4, JSON.stringify(sw));
const swShares = distribute(swiggyItems, 177 - 206);
check("Swiggy: items with shares come to what was paid", sum(swiggyItems.map((a, i) => a + swShares[i])) === 177, JSON.stringify(swShares));

// Inside a bill box a fee with an unusual name still counts; the order ID after the total does not.
const odd = readOrderBill(["Bill Details", "Item Total ₹100", "Rain Surcharge ₹20", "Late night ₹15", "Grand Total ₹135", "Order ID 12345"].join("\n"));
check("any rupee line in the bill box is a charge", same(odd.charges.map((c) => c.amount), [20, 15]) && odd.orderTotal === 135, JSON.stringify(odd));
// Outside a bill box, a priced line with no fee wording is a product, not a charge.
check("no box: a product is not a charge", readOrderBill(["Milk ₹30", "Handling fee ₹5", "Grand Total ₹35"].join("\n")).charges.length === 1);
// Each screenshot has its own sections: a second screenshot of items is not read as charges.
const split = readOrderBill(["Bill Details\nDelivery Fee ₹16", "Bread ₹40\nEggs ₹70"]);
check("sections are per screenshot", same(split.charges.map((c) => c.amount), [16]), JSON.stringify(split));
check("a dash before a price is not a discount", !isBillLine("Atta 5kg - ₹250") && isBillLine("Cashback -₹20") && isBillLine("Free cash for you -₹75.00"));
check("Item Bill is the item total", isBillLine("Item Bill ₹206.00"));

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all receipt checks passed");
