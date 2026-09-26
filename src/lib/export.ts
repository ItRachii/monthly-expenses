// Excel export of one context (Personal or a group): a Summary sheet followed
// by one sheet per month, newest first. Server-side only (exceljs + emails).

import ExcelJS from "exceljs";
import type { ExpenseDTO } from "./expenses";
import type { SettlementDTO } from "./settlements";
import { SPLIT_EQUAL } from "./constants";
import {
  applyPayments,
  computeNets,
  round2,
  simplifyDebts,
  type Transfer,
} from "./settlementMath";

export interface ExportInput {
  title: string;
  isPersonal: boolean;
  /** Group members: email -> display name. Personal: the user only. */
  memberNames: Map<string, string>;
  /** Display label for any email, including people no longer in the group. */
  nameFor: (email: string) => string;
  /** Expenses already limited to the range, ascending by date. */
  expenses: ExpenseDTO[];
  /** Settlements already limited to the range's months. */
  settlements: SettlementDTO[];
  range: { from: string; to: string } | null;
  exportedAt: Date;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONEY = "#,##0.00";
const PERCENT = "0.0%";

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

function heading(ws: ExcelJS.Worksheet, text: string) {
  const row = ws.addRow([text]);
  row.font = { bold: true, size: 13 };
  return row;
}

function table(ws: ExcelJS.Worksheet, header: string[], rows: (string | number | null)[][], moneyCols: number[] = [], percentCols: number[] = []) {
  const h = ws.addRow(header);
  h.font = { bold: true };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF5" } };
  for (const r of rows) {
    const row = ws.addRow(r);
    for (const c of moneyCols) row.getCell(c).numFmt = MONEY;
    for (const c of percentCols) row.getCell(c).numFmt = PERCENT;
  }
  return h;
}

function totalRow(ws: ExcelJS.Worksheet, cells: (string | number | null)[], moneyCols: number[] = []) {
  const row = ws.addRow(cells);
  row.font = { bold: true };
  for (const c of moneyCols) row.getCell(c).numFmt = MONEY;
  row.border = { top: { style: "thin" } };
  return row;
}

function autoWidth(ws: ExcelJS.Worksheet, min = 10, max = 48) {
  ws.columns.forEach((col) => {
    let w = min;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const len = v == null ? 0 : String(typeof v === "object" && "result" in v ? v.result : v).length;
      w = Math.max(w, Math.min(max, len + 2));
    });
    col.width = w;
  });
}

/** Per-member paid / share / net for one month's rows (emails as ids). */
function monthNets(rows: ExpenseDTO[], memberEmails: string[]) {
  return computeNets(rows, memberEmails);
}

function monthOutstanding(rows: ExpenseDTO[], memberEmails: string[], settlements: SettlementDTO[]): Transfer[] {
  const transfers = simplifyDebts(monthNets(rows, memberEmails));
  const pays = settlements.map((s) => ({ from: s.settledBy, to: s.settledTo, amount: s.amount }));
  return applyPayments(transfers, pays);
}

export async function buildWorkbook(input: ExportInput): Promise<Buffer> {
  const { expenses, settlements, isPersonal, nameFor } = input;
  const memberEmails = Array.from(input.memberNames.keys());
  const splitLabel = (v: string) => (v === SPLIT_EQUAL ? "Equal split" : nameFor(v));

  // Group rows by month, newest first.
  const byMonth = new Map<string, ExpenseDTO[]>();
  for (const r of expenses) {
    const k = r.date.slice(0, 7);
    const list = byMonth.get(k);
    if (list) list.push(r);
    else byMonth.set(k, [r]);
  }
  const monthKeys = Array.from(byMonth.keys()).sort().reverse();
  const settlementsFor = (m: string) => settlements.filter((s) => s.month === m);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Ledger";
  wb.created = input.exportedAt;

  // ---- Summary ------------------------------------------------------------
  const ws = wb.addWorksheet("Summary");
  const title = ws.addRow([input.title]);
  title.font = { bold: true, size: 16 };
  ws.addRow(["Exported", input.exportedAt.toISOString().slice(0, 19).replace("T", " ") + " UTC"]);
  ws.addRow([
    "Range",
    input.range ? `${input.range.from} to ${input.range.to}` : "Full history",
  ]);
  if (!isPersonal) {
    ws.addRow(["Members", Array.from(input.memberNames.values()).join(", ")]);
  }
  ws.addRow([]);

  const grand = round2(expenses.reduce((s, r) => s + r.amount, 0));
  heading(ws, "Overview");
  table(
    ws,
    ["Metric", "Value"],
    [
      ["Total spent", grand],
      ["Expenses", expenses.length],
      ["Months", monthKeys.length],
      ["First expense", expenses[0]?.date ?? null],
      ["Last expense", expenses[expenses.length - 1]?.date ?? null],
    ],
  );
  ws.getRow(ws.rowCount - 4).getCell(2).numFmt = MONEY;
  ws.addRow([]);

  heading(ws, "By month");
  if (isPersonal) {
    table(
      ws,
      ["Month", "Expenses", "Total"],
      monthKeys.map((m) => {
        const rows = byMonth.get(m)!;
        return [monthLabel(m), rows.length, round2(rows.reduce((s, r) => s + r.amount, 0))];
      }),
      [3],
    );
    totalRow(ws, ["Total", expenses.length, grand], [3]);
  } else {
    const names = memberEmails.map((e) => input.memberNames.get(e) ?? nameFor(e));
    const header = ["Month", "Expenses", "Total", ...names.map((n) => `${n} paid`), "Outstanding"];
    const moneyCols = [3, ...names.map((_, i) => 4 + i), 4 + names.length];
    table(
      ws,
      header,
      monthKeys.map((m) => {
        const rows = byMonth.get(m)!;
        const paid = memberEmails.map((e) =>
          round2(rows.filter((r) => r.payer === e).reduce((s, r) => s + r.amount, 0)),
        );
        const out = monthOutstanding(rows, memberEmails, settlementsFor(m));
        return [
          monthLabel(m),
          rows.length,
          round2(rows.reduce((s, r) => s + r.amount, 0)),
          ...paid,
          round2(out.reduce((s, t) => s + t.amount, 0)),
        ];
      }),
      moneyCols,
    );
    const paidTotals = memberEmails.map((e) =>
      round2(expenses.filter((r) => r.payer === e).reduce((s, r) => s + r.amount, 0)),
    );
    totalRow(ws, ["Total", expenses.length, grand, ...paidTotals, null], moneyCols);
  }
  ws.addRow([]);

  heading(ws, "By category");
  const byCat = new Map<string, number>();
  for (const r of expenses) byCat.set(r.category || "Uncategorised", (byCat.get(r.category || "Uncategorised") ?? 0) + r.amount);
  table(
    ws,
    ["Category", "Total", "Share"],
    Array.from(byCat.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([c, t]) => [c, round2(t), grand > 0 ? t / grand : 0]),
    [2],
    [3],
  );
  totalRow(ws, ["Total", grand, grand > 0 ? 1 : 0], [2]);
  ws.getRow(ws.rowCount).getCell(3).numFmt = PERCENT;

  if (!isPersonal) {
    ws.addRow([]);
    heading(ws, "Outstanding balances (after recorded settlements)");
    const agg = new Map<string, Transfer>();
    for (const m of monthKeys) {
      for (const t of monthOutstanding(byMonth.get(m)!, memberEmails, settlementsFor(m))) {
        const k = `${t.from}\n${t.to}`;
        const cur = agg.get(k);
        if (cur) cur.amount = round2(cur.amount + t.amount);
        else agg.set(k, { ...t });
      }
    }
    const lines = Array.from(agg.values()).sort((a, b) => b.amount - a.amount);
    if (lines.length === 0) {
      ws.addRow(["All settled up for this range."]).font = { italic: true };
    } else {
      table(ws, ["Who owes", "To whom", "Amount"], lines.map((t) => [nameFor(t.from), nameFor(t.to), t.amount]), [3]);
    }
  }
  autoWidth(ws, 12);
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 12, 22);

  // ---- One sheet per month ---------------------------------------------
  for (const m of monthKeys) {
    const rows = byMonth.get(m)!;
    const sheet = wb.addWorksheet(monthLabel(m));
    const t = sheet.addRow([`${input.title}: ${monthLabel(m)}`]);
    t.font = { bold: true, size: 14 };
    sheet.addRow([]);

    const header = isPersonal
      ? ["Date", "Category", "Item", "Amount", "Receipt", "GST %", "GST amount"]
      : ["Date", "Category", "Item", "Amount", "Paid by", "Split", "Receipt", "GST %", "GST amount"];
    const data = rows.map((r) =>
      isPersonal
        ? [r.date, r.category, r.item, r.amount, r.receiptMerchant, r.gstRate, r.gstAmount]
        : [r.date, r.category, r.item, r.amount, nameFor(r.payer), splitLabel(r.split), r.receiptMerchant, r.gstRate, r.gstAmount],
    );
    const h = table(sheet, header, data, isPersonal ? [4, 7] : [4, 9]);
    const monthTotal = round2(rows.reduce((s, r) => s + r.amount, 0));
    totalRow(sheet, ["Total", null, `${rows.length} expenses`, monthTotal], [4]);
    sheet.views = [{ state: "frozen", ySplit: h.number }];
    sheet.autoFilter = { from: { row: h.number, column: 1 }, to: { row: h.number, column: header.length } };

    if (!isPersonal) {
      sheet.addRow([]);
      heading(sheet, "Balances this month");
      const nets = monthNets(rows, memberEmails);
      table(
        sheet,
        ["Member", "Paid", "Share", "Net"],
        nets.map((n) => [nameFor(n.id), n.paid, n.owes, n.net]),
        [2, 3, 4],
      );
      sheet.addRow(["Net: positive = is owed, negative = owes."]).font = { italic: true, color: { argb: "FF6B7280" } };

      const pays = settlementsFor(m);
      sheet.addRow([]);
      heading(sheet, "Settlements recorded");
      if (pays.length === 0) {
        sheet.addRow(["None"]).font = { italic: true };
      } else {
        table(
          sheet,
          ["Date", "From", "To", "Amount", "Note"],
          pays
            .slice()
            .sort((a, b) => a.settledAt.localeCompare(b.settledAt))
            .map((s) => [s.settledAt.slice(0, 10), nameFor(s.settledBy), s.settledTo ? nameFor(s.settledTo) : "", s.amount, s.note]),
          [4],
        );
      }
      sheet.addRow([]);
      heading(sheet, "Still outstanding");
      const out = monthOutstanding(rows, memberEmails, pays);
      if (out.length === 0) {
        sheet.addRow(["Settled"]).font = { italic: true };
      } else {
        table(sheet, ["Who owes", "To whom", "Amount"], out.map((x) => [nameFor(x.from), nameFor(x.to), x.amount]), [3]);
      }
    }
    autoWidth(sheet);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
