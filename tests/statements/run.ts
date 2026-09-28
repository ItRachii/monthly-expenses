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

  // HDFC 2026 layout ("Millennia"), from a real statement's anonymised text:
  // date|time column, rupee sign printed as "C" with a trailing "l", a "+"
  // column for credits, "EMI" offer badges, and OFFUS EMI PRIN/INT lines.
  const hdfc2026 = [
    "Domestic Transactions",
    "22/08/2026| 00:00 IGST-VPS[ref]-RATE 18.0 -23 (Ref# [ref]) C 34.74 l",
    "02/09/2026| 01:25 NETFLIXMUMBAI C 199.00 l",
    "04/09/2026| 08:32 CREDIT CARD PAYMENTNet Banking (Ref# [ref]) + C 63,817.00 l",
    "13/09/2026| 08:05 EMI RAZ*IRCTChttps://www. C 14,074.55 l",
    "22/09/2026| 00:00 OFFUS EMI,PRIN NB:02,[ref] (Ref# [ref]) C 996.00 l",
    "22/09/2026| 00:00 OFFUS EMI,INT NBR:02,[ref] (Ref# [ref]) C 167.00 l",
    "International Transactions",
    "23/08/2026 | 03:51 EMI ANTHROPIC* CLAUDE SUBSAN FRANCISC USD 118.00 C 11,297.62 l",
    "24/08/2026 | 00:00 IGST-VPS[ref]-RATE 18.0 -23 (Ref# MT[ref]) C 71.18 l",
    "22/09/2026 | 00:00 CONSOLIDATED FCY MARKUP FEE (Ref# MT[ref]) C 395.42 l",
  ];
  const m = parseStatement([hdfc2026]);
  console.log("\n== HDFC 2026 ==");
  m.rows.forEach((r) => console.log(fmt(r)));
  console.log("warnings:", m.warnings, "| unparsed:", m.unparsed);
  check("hdfc2026: no unparsed lines", m.unparsed.length === 0, JSON.stringify(m.unparsed));
  check("hdfc2026: 6 rows", m.rows.length === 6, String(m.rows.length));
  check("hdfc2026: period Sept", m.period === "2026-09", String(m.period));
  const mpay = m.rows.find((r) => /CREDIT CARD PAYMENT/.test(r.description));
  check("hdfc2026: payment is a credit of 63817 via the + column", !!mpay && mpay.credit && mpay.total === 63817);
  const irctc = m.rows.find((r) => /IRCTC/.test(r.description));
  check("hdfc2026: EMI badge dropped: IRCTC is a domestic purchase, Travel", irctc?.kind === "domestic" && irctc.total === 14074.55 && irctc.category === "Travel" && !/^EMI/.test(irctc.description), JSON.stringify(irctc));
  const memi = m.rows.filter((r) => r.kind === "emi");
  check("hdfc2026: one EMI row: principal 996 + interest 167, #2", memi.length === 1 && memi[0].total === 1163 && memi[0].parts.length === 2 && memi[0].installment === "#2", JSON.stringify(memi.map((e) => [e.parts, e.total, e.installment, e.description])));
  check("hdfc2026: EMI description has no empty (Ref# )", !!memi[0] && !/\(|,$/.test(memi[0].description), memi[0]?.description);
  const anth = m.rows.find((r) => /ANTHROPIC/.test(r.description));
  check("hdfc2026: Anthropic intl USD 118, base 11297.62, markup 395.42, GST 71.18, total 11764.22", !!anth && anth.kind === "international" && anth.foreign?.amount === 118 && anth.parts.length === 3 && anth.total === 11764.22, JSON.stringify(anth?.parts));
  check("hdfc2026: rates 95.74 / 99.70", anth?.foreign?.rate === 95.74 && anth?.foreign?.effectiveRate === 99.7, JSON.stringify(anth?.foreign));
  const netflix = m.rows.find((r) => /NETFLIX/.test(r.description));
  check("hdfc2026: Netflix 199 Subscriptions", netflix?.total === 199 && netflix.category === "Subscriptions");
  const debits = m.rows.filter((r) => !r.credit).reduce((s, r) => s + r.total, 0);
  check("hdfc2026: debits sum to the statement's Purchases/Debit 27235.51", Math.abs(debits - 27235.51) < 0.005, debits.toFixed(2));
  check("hdfc2026: standalone IGST row kept as GST 34.74", m.rows.some((r) => r.kind === "domestic" && r.total === 34.74 && r.parts[0].kind === "gst"));

  // Two loans whose lines are printed apart: pairing must follow the loan
  // number, not adjacency. The numbers are pseudonymised per parse, so the
  // same number still means the same loan within one statement.
  const twoLoans = [
    "HDFC Bank",
    "Domestic Transactions",
    "22/09/2026| 00:00 OFFUS EMI,PRIN NB:02,00000144148470 (Ref# 09999999980922004049488) C 996.00 l",
    "22/09/2026| 00:00 OFFUS EMI,PRIN NB:05,00000177777777 (Ref# 09999999980922004049490) C 2,500.00 l",
    "02/09/2026| 01:25 NETFLIXMUMBAI C 199.00 l",
    "22/09/2026| 00:00 OFFUS EMI,INT NBR:02,00000144148470 (Ref# 09999999980922004049496) C 167.00 l",
    "22/09/2026| 00:00 OFFUS EMI,INT NBR:05,00000177777777 (Ref# 09999999980922004049497) C 310.00 l",
  ];
  const t = parseStatement([twoLoans]);
  console.log("\n== two loans ==");
  t.rows.forEach((r) => console.log(fmt(r)));
  const temi = t.rows.filter((r) => r.kind === "emi").sort((a, b) => a.total - b.total);
  check("two loans: two EMI rows paired by loan number: 1163 (#2) and 2810 (#5)", temi.length === 2 && temi[0].total === 1163 && temi[0].installment === "#2" && temi[1].total === 2810 && temi[1].installment === "#5", JSON.stringify(temi.map((e) => [e.total, e.installment, e.parts.map((p) => p.kind)])));
  check("two loans: no loan number or token in descriptions", !t.rows.some((r) => /\d{8,}|\[ref/.test(r.description)), t.rows.map((r) => r.description).join(" | "));
  const blob = JSON.stringify(t);
  check("two loans: raw numbers absent from all output", !/00000144148470|00000177777777|0999999998/.test(blob));
  check("two loans: same number gives the same token within the parse", (() => { const toks = t.redactedLines.map((l) => l.match(/NBR?:\d\d,(\[ref:[0-9a-f]{4}\])/)?.[1]).filter(Boolean); return toks.length === 4 && toks[0] === toks[2] && toks[1] === toks[3] && toks[0] !== toks[1]; })(), t.redactedLines.join(" || "));
  const t2 = parseStatement([twoLoans]);
  check("two loans: tokens differ between uploads", t.redactedLines.join() !== t2.redactedLines.join());

  // Summary box and card identity
  check("hdfc: summary limits/dues", !!h.summary && h.summary.creditLimit === 300000 && h.summary.availableCredit === 252681.58 && h.summary.availableCash === 60000 && h.summary.totalDue === 47318.42 && h.summary.minimumDue === 2365.92, JSON.stringify(h.summary));
  check("hdfc: summary dates", h.summary?.statementDate === "2026-08-12" && h.summary?.dueDate === "2026-09-01", JSON.stringify([h.summary?.statementDate, h.summary?.dueDate]));
  check("hdfc: card last4 1234 from masked number, nothing more", h.card?.last4 === "1234" && JSON.stringify(h.card).length < 60, JSON.stringify(h.card));
  check("hdfc: Swiggy transaction is not taken as the card product", h.card?.product === null, String(h.card?.product));
  check("hdfc: PAYMENT RECEIVED transaction is not read as the payments figure", h.summary?.paymentsCredits === null, String(h.summary?.paymentsCredits));
  check("icici: summary total due and dates", c.summary?.totalDue === 33691.6 && c.summary?.statementDate === "2026-08-12" && c.summary?.dueDate === "2026-09-01", JSON.stringify(c.summary));
  check("icici: card last4 9012", c.card?.last4 === "9012", JSON.stringify(c.card));

  // HDFC 2026 blue box: label rows, continuation rows, then figure rows.
  const box = [
    "HDFC Bank Millennia Credit Card Statement",
    "PREVIOUS STATEMENT DUES PAYMENTS/CREDITS PURCHASES/DEBIT FINANCE CHARGES TOTAL AMOUNT DUE",
    "RECEIVED (Current Billing Cycle)",
    "C 63,817.22 − C 63,817.00 + C 27,235.51 + C 0.00 = C 27,236.00",
    "TOTAL CREDIT LIMIT AVAILABLE CREDIT LIMIT AVAILABLE CASH LIMIT MINIMUM DUE DUE DATE",
    "(Including Cash)",
    "C 2,77,000 C 2,38,992 C 1,10,800 C 2,473.00 12 Oct, 2026",
    "Past Dues OVER LIMIT 3 MONTHS + 2 MONTHS 1 MONTH CURRENT DUES MINIMUM DUES",
    "(if any) C 0.00 C 0.00 C 0.00 C 0.00 C 2,473.00 C 2,473.00",
    "Domestic Transactions",
    "02/09/2026| 01:25 NETFLIXMUMBAI C 199.00 l",
  ];
  const b = parseStatement([box], { filename: "Sep2026_BilledStatements_7043_24-09-26_15.51.pdf" });
  check("hdfc2026 box: all nine figures", !!b.summary && b.summary.previousDues === 63817.22 && b.summary.paymentsCredits === 63817 && b.summary.purchases === 27235.51 && b.summary.financeCharges === 0 && b.summary.totalDue === 27236 && b.summary.creditLimit === 277000 && b.summary.availableCredit === 238992 && b.summary.availableCash === 110800 && b.summary.minimumDue === 2473, JSON.stringify(b.summary));
  check("hdfc2026 box: due date 12 Oct 2026", b.summary?.dueDate === "2026-10-12", String(b.summary?.dueDate));
  check("hdfc2026 box: card 7043 from the file name, product Millennia", b.card?.last4 === "7043" && b.card?.product === "Millennia", JSON.stringify(b.card));
  check("hdfc2026 box: period from the rows", b.period === "2026-09", String(b.period));
  check("hdfc2026 box: anonymised text carries labels and figures only", b.redactedLines.some((l) => l.startsWith("## summary")) && !b.redactedLines.some((l) => /Millennia Credit Card Statement/.test(l)), b.redactedLines.join(" | "));

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
