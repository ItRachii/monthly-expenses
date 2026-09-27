// Regression test for the statement parser: runs the real pipeline in Node
// against the fixture PDFs. Run with `npm run test:statements`.
//
// The fixtures are synthetic statements printed from HTML (make-fixtures.cjs)
// with made-up personal details, so the PII checks can prove nothing leaks.
// hdfc-locked.pdf is hdfc.pdf encrypted with the user password RACH0705.
import { readFileSync } from "fs";
import { join } from "path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { itemsToLines, type PositionedText } from "../../src/lib/statements/lines";
import { parseStatement } from "../../src/lib/statements/parse";

const dir = join(__dirname, "fixtures");
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failures++;
};

async function pagesOf(path: string, password?: string): Promise<string[][]> {
  const data = new Uint8Array(readFileSync(path));
  const task = pdfjs.getDocument({ data, password });
  try {
    const doc = await task.promise;
    const pages: string[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items.filter((it): it is PositionedText & typeof it => "str" in it)));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

const PII = ["AWASTHI", "RACHIT", "9876543210", "98765 43210", "@", "ABCDE1234F", "4695", "4375", "Indiranagar", "Sunrise", "50100234567890", "1092130725", "1092555312"];

function piiScan(label: string, parsed: ReturnType<typeof parseStatement>) {
  const blob = [...parsed.redactedLines, ...parsed.rows.map((r) => r.description), ...parsed.unparsed.map((u) => u.text)].join("\n");
  const hits = PII.filter((p) => blob.includes(p));
  check(`${label}: no PII in parser output`, hits.length === 0, hits.join(","));
}

const fmt = (r: { kind: string; date: string; description: string; total: number; credit: boolean; parts: { label: string; amount: number }[]; foreign: { currency: string; amount: number; rate: number; effectiveRate: number } | null; installment: string | null; category: string }) =>
  `${r.kind.padEnd(13)} ${r.date} ${r.description.padEnd(38)} ${r.credit ? "+" : " "}${r.total.toFixed(2).padStart(10)}  [${r.parts.map((p) => `${p.label} ${p.amount}`).join("; ")}]` +
  (r.foreign ? ` ${r.foreign.currency} ${r.foreign.amount} @${r.foreign.rate} eff ${r.foreign.effectiveRate}` : "") +
  (r.installment ? ` EMI ${r.installment}` : "") + ` -> ${r.category}`;

(async () => {
  // HDFC
  const h = parseStatement(await pagesOf(`${dir}/hdfc.pdf`));
  console.log("\n== HDFC ==");
  h.rows.forEach((r) => console.log(fmt(r)));
  console.log("warnings:", h.warnings, "| unparsed:", h.unparsed);
  check("hdfc: bank", h.bank === "hdfc", h.bank);
  check("hdfc: statement date", h.statementDate === "2026-08-12", String(h.statementDate));
  check("hdfc: period", h.period === "2026-08", String(h.period));
  const openai = h.rows.find((r) => /OPENAI/.test(r.description));
  check("hdfc: OpenAI is international with USD 20", !!openai && openai.kind === "international" && openai.foreign?.currency === "USD" && openai.foreign.amount === 20);
  check("hdfc: OpenAI has markup 61.33 and GST 11.04 folded in", !!openai && openai.parts.some((p) => p.amount === 61.33) && openai.parts.some((p) => p.amount === 11.04), JSON.stringify(openai?.parts));
  check("hdfc: OpenAI total 1824.77", openai?.total === 1824.77, String(openai?.total));
  check("hdfc: OpenAI rates 87.62 / 91.24", openai?.foreign?.rate === 87.62 && openai?.foreign?.effectiveRate === 91.24, JSON.stringify(openai?.foreign));
  const emi = h.rows.filter((r) => r.kind === "emi");
  check("hdfc: one EMI row with 3 parts totalling 4889.42", emi.length === 1 && emi[0].parts.length === 3 && emi[0].total === 4889.42, JSON.stringify(emi.map((e) => [e.parts.length, e.total])));
  check("hdfc: EMI installment 4 of 12", emi[0]?.installment === "4 of 12", String(emi[0]?.installment));
  const fee = h.rows.find((r) => /LATE PAYMENT/.test(r.description));
  check("hdfc: late fee has GST folded in: 590", fee?.total === 590, String(fee?.total));
  const pay = h.rows.find((r) => /PAYMENT RECEIVED/.test(r.description));
  check("hdfc: payment is a credit of 30000", !!pay && pay.credit && pay.total === 30000);
  check("hdfc: no orphan GST rows", !h.rows.some((r) => r.parts.length === 1 && r.parts[0].kind === "gst"));
  check("hdfc: 9 rows", h.rows.length === 9, String(h.rows.length));
  check("hdfc: Swiggy categorised Dining Out", h.rows.find((r) => /SWIGGY/.test(r.description))?.category === "Dining Out");
  check("hdfc: no unparsed lines", h.unparsed.length === 0, JSON.stringify(h.unparsed));
  piiScan("hdfc", h);

  // ICICI
  const c = parseStatement(await pagesOf(`${dir}/icici.pdf`));
  console.log("\n== ICICI ==");
  c.rows.forEach((r) => console.log(fmt(r)));
  console.log("warnings:", c.warnings, "| unparsed:", c.unparsed);
  check("icici: bank", c.bank === "icici", c.bank);
  check("icici: statement date August 12, 2026", c.statementDate === "2026-08-12", String(c.statementDate));
  const oa = c.rows.find((r) => /OPENAI/.test(r.description));
  check("icici: OpenAI intl USD 20, markup + GST attached, total 1833.00", !!oa && oa.kind === "international" && oa.foreign?.amount === 20 && oa.parts.length === 3 && oa.total === 1833, JSON.stringify(oa?.parts));
  const ce = c.rows.filter((r) => r.kind === "emi");
  check("icici: one EMI row, 3 parts, 3495.60, 3 of 12", ce.length === 1 && ce[0].parts.length === 3 && ce[0].total === 3495.6 && ce[0].installment === "3 of 12", JSON.stringify(ce.map((e) => [e.parts, e.total, e.installment])));
  const bk = c.rows.find((r) => /BOOKING/.test(r.description));
  check("icici: Booking.com intl EUR 85.50 @ 95.56", bk?.kind === "international" && bk.foreign?.currency === "EUR" && bk.foreign.rate === 95.56, JSON.stringify(bk?.foreign));
  check("icici: serial numbers stripped from descriptions", !c.rows.some((r) => /\d{6,}|\[ref\]/.test(r.description)), c.rows.map((r) => r.description).join(" | "));
  check("icici: BBPS payment is a credit", c.rows.find((r) => /BBPS/.test(r.description))?.credit === true);
  check("icici: 7 rows", c.rows.length === 7, String(c.rows.length));
  check("icici: Apollo categorised Healthcare", c.rows.find((r) => /APOLLO/.test(r.description))?.category === "Healthcare");
  piiScan("icici", c);

  // Password-protected copy
  let needed = false;
  let wrong = false;
  try {
    await pagesOf(`${dir}/hdfc-locked.pdf`);
  } catch (e) {
    needed = (e as { name?: string }).name === "PasswordException";
  }
  try {
    await pagesOf(`${dir}/hdfc-locked.pdf`, "nope");
  } catch (e) {
    wrong = (e as { name?: string; code?: number }).name === "PasswordException" && (e as { code?: number }).code === 2;
  }
  check("locked: asks for a password", needed);
  check("locked: rejects a wrong password with code 2", wrong);
  const l = parseStatement(await pagesOf(`${dir}/hdfc-locked.pdf`, "RACH0705"));
  check("locked: parses with the right password, same 9 rows", l.rows.length === 9, String(l.rows.length));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
