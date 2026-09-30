// Excel export of one card's whole history: its statements, every expense
// imported from them (with where each went) and the EMI instalments it
// billed. Server-side only. The card is named by bank and last four digits.

import ExcelJS from "exceljs";
import { prisma } from "./prisma";
import { BANK_LABEL } from "./cards";
import { formatDate, monthLabel } from "./format";
import type { Bank } from "./statements/types";

const MONEY = "#,##0.00";

function sheet(wb: ExcelJS.Workbook, name: string, header: string[], rows: (string | number | null)[][], moneyCols: number[]) {
  const ws = wb.addWorksheet(name);
  const h = ws.addRow(header);
  h.font = { bold: true };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF5" } };
  for (const r of rows) {
    const row = ws.addRow(r);
    for (const c of moneyCols) row.getCell(c).numFmt = MONEY;
  }
  if (rows.length === 0) ws.addRow(["None"]);
  ws.columns.forEach((col) => {
    let w = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      w = Math.max(w, Math.min(48, String(cell.value ?? "").length + 2));
    });
    col.width = w;
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** The whole card, or with `period` (YYYY-MM) just that statement. */
export async function buildCardWorkbook(ownerEmail: string, cardId: string, period?: string): Promise<{ buffer: Buffer; name: string } | null> {
  const card = await prisma.card.findFirst({
    where: { id: cardId, ownerEmail },
    include: {
      statements: {
        where: period ? { period } : undefined,
        orderBy: { period: "desc" },
        include: {
          expenses: {
            orderBy: [{ date: "asc" }, { id: "asc" }],
            select: { date: true, item: true, category: true, amount: true, group: { select: { name: true } } },
          },
        },
      },
      instalments: { where: period ? { period } : undefined, orderBy: [{ loanKey: "asc" }, { date: "asc" }] },
    },
  });
  if (!card || (period && card.statements.length === 0)) return null;
  const bank = BANK_LABEL[card.bank as Bank] ?? card.bank;
  const d = (x: Date | null) => (x ? formatDate(x) : null);

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  sheet(
    wb,
    "Statements",
    ["Month", "Statement date", "Due date", "Total due", "Minimum due", "Previous dues", "Payments", "Purchases", "Finance charges", "Credit limit", "Available credit", "Imported"],
    card.statements.map((s) => [
      monthLabel(s.period),
      d(s.statementDate),
      d(s.dueDate),
      s.totalDue,
      s.minimumDue,
      s.previousDues,
      s.paymentsCredits,
      s.purchases,
      s.financeCharges,
      s.creditLimit,
      s.availableCredit,
      formatDate(s.importedAt),
    ]),
    [4, 5, 6, 7, 8, 9, 10, 11],
  );

  sheet(
    wb,
    "Expenses",
    ["Statement", "Date", "Item", "Category", "Amount", "Added to"],
    card.statements
      .slice()
      .reverse()
      .flatMap((s) => s.expenses.map((e) => [monthLabel(s.period), formatDate(e.date), e.item, e.category, e.amount, e.group?.name ?? "Personal"])),
    [5],
  );

  sheet(
    wb,
    "EMIs",
    ["Loan", "Instalment", "Date", "Principal", "Interest", "GST", "GST billed", "Statement"],
    card.instalments.map((i) => [
      i.loanLast4 ? `…${i.loanLast4}` : "Loan",
      i.instalmentNo,
      formatDate(i.date),
      i.principal,
      i.interest,
      i.gst,
      i.gstPeriod ? monthLabel(i.gstPeriod) : null,
      monthLabel(i.period),
    ]),
    [4, 5, 6],
  );

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const name = `${bank}-${card.last4}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return { buffer, name: period ? `${name}_${period}_statement.xlsx` : `${name}_card-history.xlsx` };
}
