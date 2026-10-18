// Unit checks for the receipt scanner client (no network). Run with
// `npm run test:scanner`. The encryption vectors were made with the
// scanner's own docling-service/envelope.py, so both sides must agree.
import { deriveKey, openResponse, sealRequest } from "../../src/lib/scanner/envelope";
import { scanToLines, type ScanResult } from "../../src/lib/scanner/lines";
import { parseReceipt } from "../../src/lib/receipt/parse";

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

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all scanner checks passed");
