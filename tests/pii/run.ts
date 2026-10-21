// Unit checks for finding personal details on order screenshots (no
// network). Run with `npm run test:pii`. The scans are real (Docling), with
// made-up details put back where the saved scans have placeholders: the
// layout around them is what the checks are about.
import { readFileSync } from "fs";
import { join } from "path";
import { findPii, mask, withoutPii } from "../../src/lib/scanner/pii";
import { scanToLines, type ScanItem, type ScanResult } from "../../src/lib/scanner/lines";
import { readOrder } from "../../src/lib/receipt/readOrder";
import { settleOrder } from "../../src/lib/receipt/orderBill";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};

/** A saved scan with its placeholders, top to bottom, replaced by these. */
function scan(file: string, fakes: string[]): ScanResult {
  const r = JSON.parse(readFileSync(join(__dirname, "..", "scanner", "orders", file), "utf8")) as ScanResult;
  const holes = r.cells!.filter((c) => /\[[a-z ]+\]/.test(c.text)).sort((a, b) => a.box[1] - b.box[1]);
  if (holes.length !== fakes.length) throw new Error(`${file}: ${holes.length} placeholders, ${fakes.length} fakes`);
  holes.forEach((c, k) => (c.text = c.text.replace(/\[[a-z ]+\]/, fakes[k])));
  return r;
}
const kinds = (r: ScanResult) => {
  const tags = findPii(r);
  return (t: string) => {
    const c = r.cells!.find((x) => x.text === t);
    return c ? tags.get(c)?.kind ?? "none" : "missing";
  };
};
const tagged = (r: ScanResult) => [...findPii(r)].map(([c, t]) => `${t.kind}:${c.text}`);

// BigBasket's delivery card: name, phone, a three-line address, and at the
// bottom an order number with ten digits from 9 inside it.
const bb = scan("multi/bigbasket-c-3.json", ["Asha Verma", "9123456780", "102, Rose Villa, 14, MG Road,", "Indiranagar, Bangalore -", "560038", "BNN-9876543210-20260607"]);
const k = kinds(bb);
check("phone under the name", k("9123456780") === "phone");
check("the name above it", k("Asha Verma") === "name");
check("address, all three lines", ["102, Rose Villa, 14, MG Road,", "Indiranagar, Bangalore -", "560038"].every((t) => k(t) === "address"));
check("order number with ten digits inside is not a phone", k("BNN-9876543210-20260607") === "order-id");
check("labels are not personal", ["Delivery details", "Delivery address", "Order ID", "UPI", "Payment mode"].every((t) => k(t) === "none"));
check("nothing else tagged", tagged(bb).length === 6, tagged(bb).join("; "));

const bb2 = scan("multi/bigbasket-a-bottom.json", ["Asha Verma", "91234 56780", "12, Lake View Apartments, 3rd Cross,", "HSR Layout, Bengaluru -", "560102"]);
check("phone written with a space", kinds(bb2)("91234 56780") === "phone");
check("prices and the bill are left alone", tagged(bb2).length === 5, tagged(bb2).join("; "));

// Blinkit: "Order id" over a reference with ten digits from 9, then the address.
const bl = scan("blinkit.json", ["ORD9876543210", "8 green residency, Opp shiv mandir Arera, Bhopal"]);
check("Blinkit order id is not a phone", kinds(bl)("ORD9876543210") === "order-id");
check("Blinkit address", kinds(bl)("8 green residency, Opp shiv mandir Arera, Bhopal") === "address");

// Swiggy: an order number of exactly ten digits from 9, the restaurant
// and home addresses, and the delivery partner.
const sw = scan("swiggy.json", ["9876543210", "2nd Main Rd-12, 3rd floor, Indiranagar Above ...", "Home", "45, Palm Grove, Domlur Layout,", "Indiranagar, Bengaluru, Karnataka, India", "by Ravi Kumar"]);
const ks = kinds(sw);
check("ten digits after 'Order #' are an order number", ks("Order #9876543210") === "order-id");
check("addresses", ["2nd Main Rd-12, 3rd floor, Indiranagar Above ...", "45, Palm Grove, Domlur Layout,", "Indiranagar, Bengaluru, Karnataka, India"].every((t) => ks(t) === "address"));
check("restaurant name is not an address", ks("Faasos Wraps, Rolls & Shawarma") === "none");
check("delivery partner", ks("by Ravi Kumar") === "name");
check("dishes and prices left alone", ["Chatpata Double Egg Roll x 1", "₹119", "Item Total", "Bill Total"].every((t) => ks(t) === "none"));

// Removing them changes nothing about the order itself.
for (const [label, r, app] of [["BigBasket", bb, "BigBasket"], ["BigBasket 9", bb2, "BigBasket"], ["Blinkit", bl, "Blinkit"], ["Swiggy", sw, "Swiggy"]] as [string, ScanResult, string][]) {
  const text = scanToLines(withoutPii(r), { order: true }).join("\n");
  check(
    `${label}: no personal detail left in the text`,
    !/9123456780|91234 56780|Asha|Rose Villa|Lake View|560038|560102|residency|Palm Grove|Ravi/.test(text),
    text.split("\n").filter((l) => /\d{10}|Asha|Villa|Grove|Ravi|Lake/.test(l)).join(" / "),
  );
  const before = readOrder([scanToLines(r, { order: true }).join("\n")], app);
  const after = readOrder([text], app);
  check(`${label}: the order reads the same without them`, JSON.stringify(before) === JSON.stringify(after));
}
const swOrder = readOrder([scanToLines(withoutPii(sw), { order: true }).join("\n")], "Swiggy");
const swSettled = settleOrder(swOrder.items.map((it) => it.amount), swOrder.bill.charges.map((c) => c.amount), swOrder.bill.orderTotal);
check("Swiggy still adds up to 360", swSettled.check.status === "matched" && swOrder.bill.orderTotal === 360);
check("order numbers stay in the text", /ORD9876543210/.test(scanToLines(withoutPii(bl)).join("\n")));

// The developer view: personal pieces masked and tagged, order numbers tagged and readable.
const dev = withoutPii(bb, true).cells!;
const phone = dev.find((c: ScanItem) => c.pii?.kind === "phone")!;
check("developer view masks", phone.text === "91••••••••" && !dev.some((c) => /Asha|Rose/.test(c.text)), phone.text);
check("developer view says why", /10 digits starting 6 to 9/.test(phone.pii!.why), phone.pii!.why);
check("developer view keeps order numbers readable, with why", dev.some((c) => c.text === "BNN-9876543210-20260607" && c.ref?.kind === "order-id"));
check("mask keeps punctuation", mask("12, MG Road") === "12, •• ••••");

// Short cases.
const piece = (text: string, y: number): ScanItem => ({ text, page: 1, box: [20, y, 600, y + 30] });
const tiny = (rows: string[]) => {
  const r: ScanResult = { pages: [{ page: 1, width: 1080, height: 2400 }], items: [], cells: rows.map((t, i) => piece(t, 100 + i * 45)) };
  const tags = findPii(r);
  return rows.map((_, i) => tags.get(r.cells![i])?.kind ?? "none");
};
check("labelled mobile", JSON.stringify(tiny(["Mobile", "+91 98765 43210"])) === JSON.stringify(["none", "phone"]));
check("invoice number is not a phone", JSON.stringify(tiny(["Invoice No.", "9876543210"])) === JSON.stringify(["none", "order-id"]));
check("a number starting 1-5 is not a mobile", JSON.stringify(tiny(["Ref", "2010700677"])) === JSON.stringify(["none", "none"]));
check("email and UPI id", JSON.stringify(tiny(["asha.v@example.com", "asha@okhdfc"])) === JSON.stringify(["email", "email"]));
check("a product with a road in its name is not an address", JSON.stringify(tiny(["Road Runner Toy Car ₹499", "1 pc"])) === JSON.stringify(["none", "none"]));

// A line the scanner wrongly took for a strike through the phone number
// splits it into "91234" (struck) and "56780" (kept), neither ten digits.
const split = scan("multi/bigbasket-c-3.json", ["Asha Verma", "9123456780", "102, Rose Villa, 14, MG Road,", "Indiranagar, Bangalore -", "560038", "BNN-9876543210-20260607"]);
const whole = split.cells!.find((c) => c.text === "9123456780")!;
const [x0, y0, x1, y1] = whole.box;
const cut = Math.round((x0 + x1) / 2);
const struckHalf: ScanItem = { ...whole, text: "91234", box: [x0, y0, cut, y1], struck: true, from: whole.text };
const keptHalf: ScanItem = { ...whole, text: "56780", box: [cut, y0, x1, y1], from: whole.text };
split.cells!.splice(split.cells!.indexOf(whole), 1, struckHalf, keptHalf);
const splitTags = findPii(split);
check("a phone split at a strike line: both parts are the phone", splitTags.get(struckHalf)?.kind === "phone" && splitTags.get(keptHalf)?.kind === "phone", `${splitTags.get(struckHalf)?.kind} / ${splitTags.get(keptHalf)?.kind}`);
check("a phone split at a strike line: the name beside it is still found", [...splitTags].some(([c, t]) => c.text === "Asha Verma" && t.kind === "name"));
check("a phone split at a strike line: no part reaches the text", !/56780|91234/.test(scanToLines(withoutPii(split)).join("\n")));
const splitDev = withoutPii(split, true).cells!;
const phoneParts = splitDev.filter((c) => c.from != null && c.pii?.kind === "phone");
check("a phone split at a strike line: the developer view masks both parts and where they came from", phoneParts.length === 2 && phoneParts.every((c) => !/\d{3}/.test(c.text) && !/\d{3}/.test(c.from!)) && phoneParts.map((c) => c.text).join("") === "91••••••••", JSON.stringify(phoneParts.map((c) => [c.text, c.from])));
// Struck prices split the same way are left alone.
const zp = JSON.parse(readFileSync(join(__dirname, "..", "scanner", "orders", "zepto.json"), "utf8")) as ScanResult;
const zpTags = findPii(zp);
const zpSplit = zp.cells!.filter((c) => c.from != null);
check("struck prices are not personal details", zpSplit.length > 0 && zpSplit.every((c) => !zpTags.has(c)), `${zpSplit.length} split pieces`);

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all pii checks passed");
