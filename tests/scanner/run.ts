// Unit checks for the receipt scanner client (no network). Run with
// `npm run test:scanner`. The encryption vectors were made with the
// scanner's own docling-service/envelope.py, so both sides must agree.
import { deriveKey, openResponse, sealRequest } from "../../src/lib/scanner/envelope";
import { dropStruckPrices, scanToLines, unstrikePrice, type ScanResult } from "../../src/lib/scanner/lines";
import { parseReceipt } from "../../src/lib/receipt/parse";
import { categorize } from "../../src/lib/receipt/categorize";
import { cleanOrderItem, repeatedRows } from "../../src/lib/receipt/quickCommerce";
import { orderProducts, readOrderBill, reconcile, settleOrder } from "../../src/lib/receipt/orderBill";
import { orderCompleteness, readOrder } from "../../src/lib/receipt/readOrder";
import { stitch, type ShotRow } from "../../src/lib/receipt/stitch";
import { scanToRows } from "../../src/lib/scanner/lines";
import { readFileSync } from "fs";
import { join } from "path";
import { isDeveloper } from "../../src/lib/features";
import { emailId } from "../../src/lib/piiCrypto";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};
const throws = (f: () => unknown) => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

// From envelope.py: secret, ts 1760000000, nonce bytes 0..11 for the
// request and 12..23 for the reply.
const key = deriveKey("test-secret-0123456789abcdef0123456789abcdef");
check("key matches Python", key.toString("hex") === "d083a08c7cb147e82e68661b9b0126fcbba583f3f49552d30d2a2ce57004a1a4");

const iv = Buffer.from(Array.from({ length: 12 }, (_, i) => i));
const sealed = sealRequest(key, Buffer.from("hello receipt"), iv, 1760000000 * 1000);
check("request nonce", sealed.nonce === "AAECAwQFBgcICQoL", sealed.nonce);
check("request ts", sealed.ts === "1760000000");
check("request bytes match Python", sealed.body.toString("hex") === "75fb8d7276b0ca9fe437a72b28fbbcf42210a09bb809709370e47b92c2");

const reply = Buffer.from("aa6ab6c6647163c8707283bed0611ae839259548f2b317779e13cbc4", "hex");
check("opens Python reply", openResponse(key, reply, "DA0ODxAREhMUFRYX", sealed.nonce).toString() === '{"items":[]}');
check("reply bound to its request", throws(() => openResponse(key, reply, "DA0ODxAREhMUFRYX", "AAECAwQFBgcICQoM")));
const tampered = Buffer.from(reply);
tampered[0] ^= 1;
check("altered reply refused", throws(() => openResponse(key, tampered, "DA0ODxAREhMUFRYX", sealed.nonce)));
check("wrong key refused", throws(() => openResponse(deriveKey("another-secret-0123456789abcdef0123456789"), reply, "DA0ODxAREhMUFRYX", sealed.nonce)));
check("fresh nonce each request", sealRequest(key, Buffer.from("x")).nonce !== sealRequest(key, Buffer.from("x")).nonce);

// A Swiggy-style screenshot: names on the left, prices in their own pieces
// on the right of the same row, listed out of order as OCR may return them.
const scan: ScanResult = {
  pages: [{ page: 1, width: 1080, height: 2400 }],
  items: [
    { text: "₹54.0", page: 1, box: [900, 610, 1010, 650] },
    { text: "Instamart", page: 1, box: [40, 200, 300, 250] },
    { text: "2 x Sprite Zero", page: 1, box: [40, 605, 400, 652] },
    { text: "1 x Diet Coke Can", page: 1, box: [40, 705, 430, 752] },
    { text: "80.0", page: 1, box: [920, 708, 1010, 750] },
    { text: "Grand Total", page: 1, box: [40, 905, 300, 952] },
    { text: "₹134", page: 1, box: [900, 906, 1010, 950] },
  ],
};
const lines = scanToLines(scan);
check(
  "rows rebuilt in reading order",
  JSON.stringify(lines) === JSON.stringify(["Instamart", "2 x Sprite Zero ₹54.0", "1 x Diet Coke Can 80.0", "Grand Total ₹134"]),
  JSON.stringify(lines),
);
const parsed = parseReceipt(lines.join("\n"));
check("merchant", parsed.merchant === "Instamart", parsed.merchant);
check(
  "items with prices",
  JSON.stringify(parsed.items.map((it) => [it.description, it.amount])) === JSON.stringify([["2 x Sprite Zero", 54], ["1 x Diet Coke Can", 80]]),
  JSON.stringify(parsed.items),
);
check("total", parsed.detectedTotal === 134);

// What the scanner really returns for a simple receipt: Docling ran all the
// rows into one layout block, while the OCR cells keep them apart.
const merged: ScanResult = {
  pages: [{ page: 1, width: 1080, height: 900 }],
  items: [{ text: "Instamart 2 x Sprite Zero 54.0 Handling fee 9.0 Grand Total 63", page: 1, box: [34, 84, 1048, 687] }],
  cells: [
    { text: "Instamart", page: 1, box: [37, 84.4, 212.8, 126] },
    { text: "2 x Sprite Zero", page: 1, box: [34.3, 221.8, 301.6, 271] },
    { text: "54.0", page: 1, box: [936.3, 222.8, 1045.7, 266.6] },
    { text: "Handling fee", page: 1, box: [34.3, 500.8, 276.5, 552.2] },
    { text: "9.0", page: 1, box: [979.3, 499.8, 1048.4, 548.4] },
    { text: "Grand Total", page: 1, box: [35.4, 640.9, 258.6, 687.4] },
    { text: "63", page: 1, box: [942.8, 641.5, 1045.2, 686.4] },
  ],
};
const fromCells = scanToLines(merged);
check(
  "cells preferred over merged blocks",
  JSON.stringify(fromCells) === JSON.stringify(["Instamart", "2 x Sprite Zero 54.0", "Handling fee 9.0", "Grand Total 63"]),
  JSON.stringify(fromCells),
);
check("blocks used when no cells", scanToLines({ ...merged, cells: [] }).length === 1);

const twoPages = scanToLines({
  pages: [
    { page: 1, width: 600, height: 800 },
    { page: 2, width: 600, height: 800 },
  ],
  items: [
    { text: "Page two", page: 2, box: [10, 10, 100, 30] },
    { text: "Page one", page: 1, box: [10, 10, 100, 30] },
  ],
});
check("pages in order", JSON.stringify(twoPages) === JSON.stringify(["Page one", "Page two"]), JSON.stringify(twoPages));

// A real Zepto order, as RapidOCR (the scanner's OCR) reads it. The water's
// original ₹120 is struck out under the ₹106 paid and comes back as a bare
// "120" on the name's second line; the bill's "₹188 ₹174" and "₹228 ₹174"
// come back as "188174" and "228174".
const zeptoCells: [string, number, number, number, number][] = [
    ["9:19", 57, 42, 114, 71],
    ["23", 605, 45, 645, 71],
    ["<", 37, 142, 65, 176],
    ["Order #SOOJRBIWE82003", 98, 133, 369, 155],
    ["Get Help", 579, 143, 675, 173],
    ["3 items", 95, 158, 174, 185],
    ["Arrived in", 585, 236, 685, 262],
    ["Delivered", 107, 250, 275, 288],
    ["49 MINS", 550, 272, 669, 302],
    ["3 items in order", 40, 362, 234, 391],
    ["Nandini Toned Fresh Milk | Pouch", 143, 424, 518, 454],
    ["₹48", 617, 424, 673, 456],
    ["1 pack (500 ml)  2 units", 143, 459, 389, 485],
    ["Zyro by Karan Aujla | Zero Sugar Tonic", 144, 547, 567, 576],
    ["₹106", 605, 546, 672, 577],
    ["Water (250ml)", 141, 572, 313, 606],
    ["120", 615, 578, 672, 606],
    ["1 pc (250 ml)2 units", 142, 607, 365, 636],
    ["Kinley Soda | Refreshing Carbonated", 141, 689, 555, 722],
    ["₹20", 617, 692, 671, 721],
    ["Drink", 143, 719, 211, 747],
    ["1 pc (750 ml)1 unit", 141, 750, 351, 781],
    ["日", 28, 863, 62, 897],
    ["Bill Summary", 66, 859, 271, 900],
    ["Item Total", 27, 932, 132, 958],
    ["188174", 578, 930, 685, 956],
    ["Delivery Fee", 27, 983, 155, 1012],
    ["30 FREE", 574, 983, 685, 1009],
    ["Handling Fee", 26, 1035, 163, 1063],
    ["10 FREE", 577, 1035, 685, 1061],
    ["Total Bill", 26, 1119, 142, 1149],
    ["228174", 554, 1116, 686, 1149],
    ["Download Invoice / Credit Note", 343, 1240, 653, 1267],
    ["Order Details", 28, 1362, 220, 1393],
    ["1", 86, 1420, 113, 1435],
    ["Rate Order", 110, 1478, 271, 1510],
    ["Order Again", 431, 1476, 610, 1514]
];
const zepto: ScanResult = {
  pages: [{ page: 1, width: 712, height: 1600 }],
  items: [],
  cells: zeptoCells.map(([text, l, t, r, b]) => ({ text, page: 1, box: [l, t, r, b] })),
};
const zeptoLines = scanToLines(zepto, { order: true });
const zeptoItems = parseReceipt(orderProducts(zeptoLines.join("\n"))).items.map((it) => [it.description, it.amount]);
check(
  "Zepto: struck-out price is not an item",
  JSON.stringify(zeptoItems) ===
    JSON.stringify([["Nandini Toned Fresh Milk | Pouch", 48], ["Zyro by Karan Aujla | Zero Sugar Tonic", 106], ["Kinley Soda | Refreshing Carbonated", 20]]),
  JSON.stringify(zeptoItems),
);
const zeptoBill = readOrderBill(zeptoLines.join("\n"));
check("Zepto: struck totals read as the price paid", zeptoBill.itemTotal === 174 && zeptoBill.orderTotal === 174 && zeptoBill.charges.length === 0, JSON.stringify(zeptoBill));
check("Zepto: adds up", reconcile(zeptoItems.map((it) => it[1] as number), [], zeptoBill.orderTotal).status === "matched");
check("receipts keep every price", scanToLines(zepto).some((l) => l.endsWith(" 120")));
check(
  "struck pairs",
  ["188174", "228174", "3025", "12099"].map(unstrikePrice).join() === "174,174,25,99" &&
    ["1299", "2026", "1200", "₹1299", "54.0", "213456789012"].every((t) => unstrikePrice(t) === t),
);
// Prices of separate items, a line or more apart, are all kept.
const separate = dropStruckPrices([
  { text: "₹54.0", page: 1, box: [900, 610, 1010, 650] },
  { text: "80.0", page: 1, box: [920, 708, 1010, 750] },
]);
check("prices of separate items kept", separate.length === 2, JSON.stringify(separate));
const bigger = dropStruckPrices([
  { text: "₹54", page: 1, box: [900, 610, 1010, 640] },
  { text: "₹80", page: 1, box: [900, 642, 1010, 690] },
]);
check("a larger price below is not a struck one", bigger.length === 2);
const twoColumns = dropStruckPrices([
  { text: "₹54", page: 1, box: [900, 610, 1010, 650] },
  { text: "₹20", page: 1, box: [400, 651, 480, 690] },
]);
check("a price in another column is kept", twoColumns.length === 2);

// Five real orders as the scanner (Docling 2.140.0, with its strike check)
// returned them; addresses and order numbers replaced. Each must come out
// with the right items and add up to what was paid.
const orders: [string, string, [string, number | null, number][], number][] = [
  ["zepto", "Zepto", [["Nandini Toned Fresh Milk | Pouch", null, 48], ["Zyro by Karan Aujla | Zero Sugar Tonic", null, 106], ["Kinley Soda | Refreshing Carbonated", null, 20]], 174],
  ["zepto2", "Zepto", [["Tata Salt | Free Flowing and lodized", null, 29], ["Daily Good Saunf - Fennel", null, 65], ["Tata Sampann Coriander Powder With", null, 41], ["24 Mantra Organic Sugar", null, 117]], 252],
  ["swiggy", "Swiggy", [["Chipotle Potato Shots Wrap", 1, 169], ["Chatpata Double Egg Roll", 1, 119], ["Aloo Patty Chipotle Burger Wrap", 1, 149]], 360],
  ["bigbasket", "BigBasket", [["Onion - Organically Grown", null, 52], ["Zero Sugar Lemon Lime Sparkling .….", null, 60], ["Anti Roach Gel", null, 99]], 188.27],
  ["blinkit", "Blinkit", [["lok Coca-Cola Diet-Coke Diets & Lights", 1, 297]], 309],
];
for (const [file, app, want, paid] of orders) {
  const scanned = JSON.parse(readFileSync(join(__dirname, "orders", `${file}.json`), "utf8")) as ScanResult;
  const read = readOrder([scanToLines(scanned, { order: true }).join("\n")], app);
  const got = read.items.map((it) => [it.description, it.qty, it.amount]);
  check(`${file}: items`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  const settled = settleOrder(read.items.map((it) => it.amount), read.bill.charges.map((c) => c.amount), read.bill.orderTotal);
  check(`${file}: adds up to ${paid}`, settled.check.status === "matched" && read.bill.orderTotal === paid, JSON.stringify(settled.check));
  const final = read.items.map((it, k) => it.amount + (settled.shares?.[k] ?? 0));
  check(`${file}: expenses come to what was paid`, Math.round(final.reduce((a, b) => a + b, 0) * 100) === Math.round(paid * 100));
}
const swiggyFood = readOrder([scanToLines(JSON.parse(readFileSync(join(__dirname, "orders", "swiggy.json"), "utf8")), { order: true }).join("\n")], "Swiggy");
check("food orders are meals out", swiggyFood.items.every((it) => it.category === "Dining Out"));
const zepto2 = JSON.parse(readFileSync(join(__dirname, "orders", "zepto2.json"), "utf8")) as ScanResult;
check(
  "struck pieces never reach the text",
  !scanToLines(zepto2).some((l) => /\b(175|423|463)\b/.test(l)) && zepto2.cells!.filter((c) => c.struck).length === 8,
);
// A scanner that checked the image is trusted: no layout guessing on top.
const checked: ScanResult = { ...zepto, strikeCheck: true };
check("no layout guessing once the scanner checked", scanToLines(checked, { order: true }).some((l) => l.endsWith(" 120")));

// One long BigBasket order in several screenshots, uploaded in any order
// (real scans). Each must come out whole: right order, shared rows once.
const shotOf = (name: string): ShotRow[] =>
  scanToRows(JSON.parse(readFileSync(join(__dirname, "orders", "multi", `${name}.json`), "utf8")), { order: true });
const multi = (names: string[]) => {
  const joined = stitch(names.map(shotOf));
  const read = readOrder([joined.text], "BigBasket");
  const settled = settleOrder(read.items.map((it) => it.amount), read.bill.charges.map((c) => c.amount), read.bill.orderTotal);
  return { joined, read, settled, complete: orderCompleteness(joined.text, read), names };
};
const order9 = ["Tomato - Hybrid", "Sweet Potato", "Carrot - Orange", "Potato", "Cabbage", "Pasteurised Toned Milk", "Curd", "Multigrain Bread", "The Laughing Cow Cheese Slices"];
for (const [label, names] of [
  ["no overlap, bottom one first", ["bigbasket-a-bottom", "bigbasket-a-top"]],
  ["overlapping", ["bigbasket-b-top", "bigbasket-b-bottom"]],
  ["overlapping, bottom one first", ["bigbasket-b-bottom", "bigbasket-b-top"]],
] as [string, string[]][]) {
  const m = multi(names);
  check(`stitch ${label}: top first`, names[m.joined.order[0]].endsWith("top"), JSON.stringify(m.joined.order));
  check(`stitch ${label}: 9 items once`, JSON.stringify(m.read.items.map((it) => it.description)) === JSON.stringify(order9), JSON.stringify(m.read.items.map((it) => it.description)));
  check(`stitch ${label}: adds up to 328.04`, m.settled.check.status === "matched" && m.read.bill.orderTotal === 328.04, JSON.stringify(m.settled.check));
  check(`stitch ${label}: complete`, !m.complete.missing && m.complete.expected === 9, JSON.stringify(m.complete));
}
check("overlap found: 4 shared rows", multi(["bigbasket-b-top", "bigbasket-b-bottom"]).joined.joins[0].overlap === 4);
// 17 items over three screenshots, one item cut at the bottom of the first,
// the middle screenshot uploaded twice, all shuffled.
const big = multi(["bigbasket-c-3", "bigbasket-c-2-again", "bigbasket-c-1", "bigbasket-c-2"]);
check("stitch 17: order 1, 2, 3", JSON.stringify(big.joined.order.map((i) => big.names[i])) === JSON.stringify(["bigbasket-c-1", "bigbasket-c-2-again", "bigbasket-c-3"]), JSON.stringify(big.joined.order));
check("stitch 17: the repeat left out", big.joined.duplicates.length === 1);
check("stitch 17: cut item once, 17 items", big.read.items.length === 17 && big.read.items.filter((it) => /Idli Batter/.test(it.description)).length === 1, String(big.read.items.length));
check("stitch 17: adds up to 1214.76", big.settled.check.status === "matched" && big.read.bill.orderTotal === 1214.76, JSON.stringify(big.settled.check));
check("stitch 17: complete", !big.complete.missing && big.complete.expected === 17);
// The middle screenshot never uploaded: flagged, with where.
const gap = multi(["bigbasket-c-3", "bigbasket-c-1"]);
check("gap: flagged as missing", gap.complete.missing && gap.complete.found === 11 && gap.complete.expected === 17 && gap.complete.short === 714.5, JSON.stringify(gap.complete));
check("gap: no overlap where it is", gap.joined.joins.length === 1 && gap.joined.joins[0].overlap === 0);
check("no bill screenshot: flagged", multi(["bigbasket-c-2", "bigbasket-c-1"]).complete.noTotal);
check("one screenshot: unchanged text", stitch([shotOf("bigbasket-c-1")]).text === scanToRows(JSON.parse(readFileSync(join(__dirname, "orders", "multi", "bigbasket-c-1.json"), "utf8")), { order: true }).map((r) => r.text).join("\n"));

// The cases combined. Real scans cut into more screenshots, the way a user
// scrolling a page at a time would take them: the sticky header and footer
// on each, the order's rows split between them.
// Header (status bar, "Order delivered", date) above 0.12, footer ("Quick actions") below 0.9.
const chrome = (r: ShotRow) => r.y < 0.12 || r.y > 0.9;
const part = (rows: ShotRow[], from: number, to: number) => rows.filter((r) => chrome(r) || (r.y >= from && r.y < to));
const c1 = shotOf("bigbasket-c-1");
// Split just above Garlic: a page-at-a-time scroll that shares no rows.
const garlic = c1.find((r) => /^Garlic/.test(r.text))!;
const c1Top = part(c1, 0, garlic.y - 0.001);
const c1Bottom = part(c1, garlic.y - 0.001, 1);
const readParts = (shots: ShotRow[][], taken?: number[]) => {
  const joined = stitch(shots, taken);
  const read = readOrder([joined.text], "BigBasket");
  const settled = settleOrder(read.items.map((it) => it.amount), read.bill.charges.map((c) => c.amount), read.bill.orderTotal);
  return { joined, read, settled, complete: orderCompleteness(joined.text, read) };
};
const wholeOrder = (m: ReturnType<typeof readParts>) =>
  m.read.items.length === 17 && m.settled.check.status === "matched" && m.read.bill.orderTotal === 1214.76 && !m.complete.missing;
// No overlap, overlap, a repeat and a shuffle, all in one upload.
const mixed = readParts([shotOf("bigbasket-c-3"), c1Bottom, shotOf("bigbasket-c-2-again"), c1Top, shotOf("bigbasket-c-2")]);
check("mixed: whole order, once", wholeOrder(mixed), `${mixed.read.items.length} items, ${JSON.stringify(mixed.settled.check)}`);
check("mixed: order top to bottom", JSON.stringify(mixed.joined.order) === JSON.stringify([3, 1, 2, 0]) || JSON.stringify(mixed.joined.order) === JSON.stringify([3, 1, 4, 0]), JSON.stringify(mixed.joined.order));
check("mixed: one join without overlap, two with", JSON.stringify(mixed.joined.joins.map((j) => j.overlap > 0)) === JSON.stringify([false, true, true]), JSON.stringify(mixed.joined.joins));
check("mixed: the repeat left out", mixed.joined.duplicates.length === 1);
// The Garlic row cut at the bottom of the upper screenshot ("Garlic ₹27"
// for "₹27.60"), the lower one starting with it whole, no other row shared.
const cutTop = [...c1Top.filter((r) => r.y <= 0.9), { text: "Garlic ₹27", y: garlic.y - 0.002 }, ...c1Top.filter((r) => r.y > 0.9)];
const cutMix = readParts([c1Bottom, shotOf("bigbasket-c-3"), cutTop, shotOf("bigbasket-c-2")]);
check(
  "cut item row at a join without overlap: read once, whole",
  wholeOrder(cutMix) && cutMix.read.items.filter((it) => it.description.startsWith("Garlic")).map((it) => it.amount).join() === "27.6",
  `${cutMix.read.items.length} items, ${JSON.stringify(cutMix.settled.check)}`,
);
// A part never uploaded, among overlaps and a repeat: flagged.
const missingMid = readParts([shotOf("bigbasket-c-3"), c1Top, shotOf("bigbasket-c-2"), shotOf("bigbasket-c-2-again")]);
check("mixed gap: flagged", missingMid.complete.missing && missingMid.complete.found < 17 && missingMid.complete.short != null, JSON.stringify(missingMid.complete));
// A long order in many small screenshots (more than are tried in every
// order), shuffled, with a repeat: cut a page at a time, item by item.
const c2 = shotOf("bigbasket-c-2");
const names = (rows: ShotRow[]) => rows.filter((r) => !chrome(r) && /₹\d/.test(r.text)).map((r) => r.y);
const slices = (rows: ShotRow[], every: number) => {
  const at = names(rows).filter((_, k) => k % every === 0);
  return at.map((y, k) => part(rows, y - 0.001, (at[k + 1] ?? 1.1) - 0.001));
};
const many = [...slices(c1, 3), ...slices(c2, 3), shotOf("bigbasket-c-3")];
// Shuffled, one repeated; the file times say the order they were taken in.
const shuffle = [5, 0, 10, 7, 2, 9, 6, 1, 8, 4, 3, 2];
const shuffled = shuffle.map((k) => many[k]);
const longOne = readParts(shuffled, shuffle);
check(`${shuffled.length} screenshots, shuffled, one repeated: whole order once`, wholeOrder(longOne) && longOne.joined.duplicates.length === 1, `${longOne.read.items.length} items, ${JSON.stringify(longOne.settled.check)}, order ${JSON.stringify(longOne.joined.order)}`);
// Without file times nothing orders the parts that share no rows: the list
// may come out of order, but every item is there once and the bill adds up.
const noTimes = readParts(shuffled);
check("same, without file times: whole order once", wholeOrder(noTimes), `${noTimes.read.items.length} items, ${JSON.stringify(noTimes.settled.check)}`);

// Two sessions' screenshots of the 9-item order together: one top repeated,
// the two bottoms overlapping each other almost entirely.
const nine = readParts(["bigbasket-a-bottom", "bigbasket-b-top", "bigbasket-b-bottom", "bigbasket-a-top"].map(shotOf));
check(
  "mixed 9: once each, adds up",
  JSON.stringify(nine.read.items.map((it) => it.description)) === JSON.stringify(order9) && nine.settled.check.status === "matched" && nine.joined.duplicates.length === 1,
  JSON.stringify({ items: nine.read.items.map((it) => it.description), check: nine.settled.check, dup: nine.joined.duplicates }),
);

// Made-up parts: a row cut in half at the edge, and a pack size that several items share.
const rowsAt = (texts: string[], from = 0.1, step = 0.05) => texts.map((text, i) => ({ text, y: from + i * step }));
const cut = stitch([
  rowsAt(["Order delivered", "Milk ₹30", "1 X 1 L", "Brown Bread ₹40", "1 X 400 g", "Farm Eggs 12 pcs ₹7"]), // "₹70" cut at the bottom
  rowsAt(["Order delivered", "Brown Bread ₹40", "1 X 400 g", "Farm Eggs 12 pcs ₹70", "Butter ₹55", "Bill total ₹195"], 0.1, 0.07),
]);
check(
  "half-cut row at the edge kept once, as read in full",
  (cut.text.match(/Eggs/g) ?? []).length === 1 && /Eggs 12 pcs ₹70/.test(cut.text) && (cut.text.match(/Bread/g) ?? []).length === 1,
  JSON.stringify(cut.text),
);
const generic = stitch([
  rowsAt(["Milk ₹30", "1 X 1 L"]),
  rowsAt(["1 X 1 L", "Juice ₹99", "1 X 1 L"]),
]);
check("a shared pack size alone is not an overlap", generic.joins[0].overlap === 0);

// Quick-commerce order lines, as read from a real Instamart screenshot.
const order = parseReceipt(["2 x Sprite Zero Delivered ₹54.0", "1x [Combo] Coca-Cola Diet Coke Can 80.0", "1 x Eveready AAA Battery | Pack of 4 43.0", "Grand Total 177"].join("\n"));
const cleaned = order.items.map((it) => ({ ...cleanOrderItem(it.description), amount: it.amount }));
check(
  "order lines: quantity and status taken off the name",
  JSON.stringify(cleaned) ===
    JSON.stringify([
      { description: "Sprite Zero", qty: 2, amount: 54 },
      { description: "[Combo] Coca-Cola Diet Coke Can", qty: 1, amount: 80 },
      // The receipt parser reads a number just before the price as a column,
      // so "Pack of 4" loses its 4; the amount is still right.
      { description: "Eveready AAA Battery | Pack of", qty: 1, amount: 43 },
    ]),
  JSON.stringify(cleaned),
);
check("order lines add up to the total", cleaned.reduce((s, it) => s + it.amount, 0) === order.detectedTotal);
check("a name without a quantity is kept", JSON.stringify(cleanOrderItem("Amul Taaza Milk 1L")) === JSON.stringify({ description: "Amul Taaza Milk 1L", qty: null }));
check("no space after the x", JSON.stringify(cleanOrderItem("1x[Combo] Coca-Cola Diet Coke Can")) === JSON.stringify({ description: "[Combo] Coca-Cola Diet Coke Can", qty: 1 }));
check("a size in the name is not a quantity", JSON.stringify(cleanOrderItem("4x4 Cable")) === JSON.stringify({ description: "4x4 Cable", qty: null }));
check("Qty prefix", JSON.stringify(cleanOrderItem("Qty 3 Bananas")) === JSON.stringify({ description: "Bananas", qty: 3 }));
check("a name that is only a status is not emptied", cleanOrderItem("Delivered").description === "Delivered");

// Categories match whole words: "ola" is Ola, not Coca-Cola; "rice" is not "price".
const categories: [string, string][] = [
  ["[Combo] Coca-Cola Diet Coke Can", "Groceries"], ["Ola ride", "Transport"], ["USB cable", "Shopping"],
  ["Basmati Rice 5kg", "Groceries"], ["Price drop", "Other"], ["Eggs 12", "Groceries"], ["Flat rent October", "Housing"],
  ["Current account fee", "Other"], ["Business lunch", "Dining Out"], ["Bus ticket", "Transport"], ["Corn Flakes", "Groceries"],
  ["Sprite Zero", "Groceries"], ["Spare parts", "Other"],
  ["Ginger - Organically Grown", "Groceries"], ["Premium Ladies' Fingers", "Groceries"], ["Palak - Cleaned, Without Roots", "Groceries"],
  ["Frozen - Green Peas", "Groceries"], ["Minute Fresh Idli Batter", "Groceries"], ["Color Shine Mini Nail Paint Kit", "Other"],
];
const wrong = categories.filter(([d, want]) => categorize(d) !== want).map(([d]) => `${d} -> ${categorize(d)}`);
check("categories match whole words", wrong.length === 0, wrong.join("; "));

// Overlapping screenshots: the overlap is read twice.
check(
  "rows repeated from an earlier screenshot",
  JSON.stringify(repeatedRows([["Milk", "Bread", "Handling fee"], ["Handling fee", "Eggs"]], ["Milk", "Bread", "Handling fee", "Handling fee", "Eggs"])) ===
    JSON.stringify([false, false, false, true, false]),
);
check(
  "two of the same item on one screenshot are both kept",
  JSON.stringify(repeatedRows([["Milk", "Milk"], ["Milk"]], ["Milk", "Milk", "Milk"])) === JSON.stringify([false, false, true]),
);
check("one screenshot: nothing repeats", repeatedRows([["A", "B", "a"]], ["A", "B", "a"]).every((r) => !r));

// Who may see the developer pages. Sessions hold user ids, never addresses.
const env = process.env as Record<string, string | undefined>;
const savedEnv = { NODE_ENV: env.NODE_ENV, DEVELOPER_EMAILS: env.DEVELOPER_EMAILS, PII_SECRET: env.PII_SECRET };

async function developerChecks() {
  env.PII_SECRET = "test-pii-secret";
  const dev = await emailId("dev@example.com");
  const other = await emailId("other@example.com");
  const user = await emailId("user@example.com");
  env.NODE_ENV = "production";
  env.DEVELOPER_EMAILS = " Dev@Example.com , other@example.com";
  check("developer listed, by user id", (await isDeveloper(dev)) && (await isDeveloper(other)));
  check("raw address is not a session id", !(await isDeveloper("dev@example.com")));
  check("others are not developers", !(await isDeveloper(user)) && !(await isDeveloper(null)) && !(await isDeveloper("")));
  env.DEVELOPER_EMAILS = "";
  check("nobody in production without a list", !(await isDeveloper(dev)));
  env.NODE_ENV = "development";
  check("everyone locally without a list", await isDeveloper(user));
  env.DEVELOPER_EMAILS = "dev@example.com";
  check("only the list locally once set", !(await isDeveloper(user)) && (await isDeveloper(dev)));
  Object.assign(env, savedEnv);
}

void developerChecks().then(() => {
  if (failures) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("all scanner checks passed");
});
