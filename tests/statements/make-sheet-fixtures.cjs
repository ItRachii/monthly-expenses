// Writes a synthetic HDFC spreadsheet statement (.xlsx) and the same sheet
// saved as CSV. The layout copies HDFC's "BilledStatements" Excel download
// cell for cell: labels in column A with values in E, the account summary
// as labels over figures, the transaction table with its customer-name
// column, reward points, GST summary and loan summary. Every personal
// detail is made up, so run.ts can prove none of it survives the pipeline.
// The references match the August PDF fixture, so lineage can be tested
// across formats.
//   node tests/statements/make-sheet-fixtures.cjs
const ExcelJS = require("exceljs");
const fs = require("fs");
const out = process.argv[2] || __dirname + "/fixtures";

const NAME = "ANANYA VERMA";
const CKYC = "30017735524418";
const holder = `${NAME}       [CKYC ID : ${CKYC} ]`;

// [row, col letter, value, merge-to column letter]
const cells = [
  [1, "A", "Name", "D"], [1, "E", NAME, "I"],
  [2, "A", "Address", "D"], [2, "E", "INDIRANAGAR  ", "I"],
  [3, "A", "Address", "D"], [3, "E", "BENGALURU-560038 KA", "I"], [3, "N", "Credit Card No.: 552233XXXXXX7043", "Y"],
  [4, "A", "CKYC ID", "D"], [4, "E", CKYC, "I"], [4, "N", "Alternate Account Number: 4011223344556677889", "Y"],
  [5, "A", "Customer GSTN", "D"], [5, "E", "", "I"],
  [6, "A", "Payment Due Date", "D"], [6, "E", "12 Oct, 2026", "I"],
  [7, "A", "Statement Date", "D"], [7, "E", "22 Sep, 2026", "I"],
  [8, "A", "Total Amount Due", "D"], [8, "E", "27,236.00", "I"], [8, "K", "Past Dues (If any)", "Y"],
  [9, "A", "Minimum Amount Due", "D"], [9, "E", "2,473.00", "I"], [9, "K", "Overlimit", "M"], [9, "N", "3 Months+", "O"], [9, "P", "2 Months", "Q"], [9, "R", "1 Month", "S"], [9, "T", "Current Dues", "V"], [9, "W", "Minimum Amount Due", "Y"],
  [10, "A", "Credit Limit", "D"], [10, "E", "2,77,000", "I"], [10, "K", "0.00", "M"], [10, "N", "0.00", "O"], [10, "P", "0.00", "Q"], [10, "R", "0.00", "S"], [10, "T", "2,473.00", "V"], [10, "W", "2,473.00", "Y"],
  [11, "A", "Available Limit", "D"], [11, "E", "2,38,992", "I"],
  [12, "A", "Available Cash Limit", "D"], [12, "E", "1,10,800", "I"],
  [14, "A", "Account Summary", "Y"],
  [15, "A", "Opening Bal", "D"], [15, "E", "-"], [15, "F", "Payment / Credit", "I"], [15, "J", "+"], [15, "K", "Purchases / Debits", "N"], [15, "O", "+"], [15, "P", "Finance Charges", "S"], [15, "T", "="], [15, "U", "Total Dues", "Y"],
  [16, "A", "63,817.22", "D"], [16, "F", "63,817.00", "I"], [16, "K", "27,235.51", "N"], [16, "P", "0.00", "S"], [16, "U", "27,236.00", "Y"],
  [19, "A", "Transaction type", "D"], [19, "E", "Primary / Addon Customer Name", "I"], [19, "J", "Date & Time", "L"], [19, "M", "Description", "R"], [19, "S", "REWARDS", "T"], [19, "U", "AMT", "W"], [19, "X", "Debit / Credit", "Y"],
];

const txns = [
  ["Domestic", "22/08/2026 / 00:00", "IGST-VPS5811462039786- RATE 18.0 -23 (Ref# 05555555520822779799514)", "34.74", ""],
  ["Domestic", "02/09/2026 / 01:25", "NETFLIX MUMBAI ", "199.00", ""],
  ["Domestic", "04/09/2026 / 08:32", "CREDIT CARD PAYMENT Net Banking (Ref# 00000000000904027274492)", "63,817.00", "Cr"],
  ["Domestic", "13/09/2026 / 08:05", "RAZ*IRCTC https://www. ", "14,074.55", ""],
  // The loan number arrives split by a cell wrap: "0 0000266258470".
  ["Domestic", "22/09/2026 / 00:00", "OFFUS EMI,PRIN NB:02,0 0000266258470 (Ref# 05555555520922779794911)", "996.00", ""],
  ["Domestic", "22/09/2026 / 00:00", "OFFUS EMI,INT NBR:02,0 0000266258470 (Ref# 05555555520922779794945)", "167.00", ""],
  ["International", "23/08/2026 / 03:51", "ANTHROPIC* CLAUDE SUB SAN FRANCISC ", "11,297.62", ""],
  ["International", "24/08/2026 / 00:00", "IGST-VPS5811462039796- RATE 18.0 -23 (Ref# MT262360097000123456708)", "71.18", ""],
  // "MARKU P": the word is split in the export too.
  ["International", "22/09/2026 / 00:00", "CONSOLIDATED FCY MARKU P FEE (Ref# MT262360097000123456708)", "395.42", ""],
];
txns.forEach((t, i) => {
  const r = 20 + i;
  cells.push([r, "A", t[0], "D"], [r, "E", holder, "I"], [r, "J", t[1], "L"], [r, "M", t[2], "R"], [r, "S", "", "T"], [r, "U", t[3], "W"], [r, "X", t[4], "Y"]);
});

cells.push(
  [30, "A", "Reward Points Summary", "Y"],
  [31, "A", "Opening Balance", "D"], [31, "E", "Earned", "G"], [31, "H", "Disbursed", "J"], [31, "K", "Adjusted/Lapsed", "N"], [31, "O", "Reward Points", "R"], [31, "S", "Points expiring in next 30 days", "V"], [31, "W", "Points expiring in next 60 days", "Y"],
  [32, "A", "2,046", "D"], [32, "E", "1,385", "G"], [32, "H", "0", "J"], [32, "K", "0", "N"], [32, "O", "3,431", "R"], [32, "S", "0", "V"], [32, "W", "0", "Y"],
  [34, "A", "Rewards Program Points Summary", "Y"],
  [35, "A", "Programs", "P"], [35, "Q", "Bonus Points", "Y"],
  [36, "A", "1% CashBack on all_other_Spends", "P"], [36, "Q", "426", "Y"],
  [37, "A", "Total", "P"], [37, "Q", "1385", "Y"],
  [43, "A", "GST Summary", "Y"],
  [44, "A", "IGST", "E"], [44, "F", "CGST", "J"], [44, "K", "SGST", "O"], [44, "P", "Reversal", "T"], [44, "U", "Total", "Y"],
  [45, "A", "105.92", "E"], [45, "F", "0", "J"], [45, "K", "0", "O"], [45, "P", "0", "T"], [45, "U", "105.92", "Y"],
  [47, "A", "*GST levied on statement date is always billed in the subsequent statement.", "Y"],
  [49, "A", "Loan Summary", "Y"],
  [50, "A", "Loan Type", "C"], [50, "D", "Loan Number", "F"], [50, "G", "Loan Booked Date", "I"], [50, "J", "Loan Amount", "L"], [50, "M", "Loan Tenure", "N"], [50, "O", "Rate of Interest", "P"], [50, "Q", "Balance Principal Outstanding", "S"], [50, "T", "Balance Interest Payable", "V"], [50, "W", "Balance Tenure", "Y"],
  // The loan number is a number cell here: its leading zeros are gone.
  [51, "A", "Smart EMI", "C"], [51, "D", 266258470, "F"], [51, "G", "10/08/2026", "I"], [51, "J", "12,749.80", "L"], [51, "M", "12 Months", "N"], [51, "O", "17%", "P"], [51, "Q", "10,771.80", "S"], [51, "T", "857.00", "V"], [51, "W", "10 Months", "Y"],
  [52, "A", "*Pre-closure charges as applicable.", "Y"],
  [54, "A", "State account branch GSTN:   33AAAAA0000A1Z5 [ State code : Tamil Nadu ]", "Y"],
  [55, "A", "HSN Code : 997113", "Y"],
  [56, "A", "Registered Office Address: HDFC Bank Cards Division, Chennai - 600058", "Y"],
);

const colNo = (l) => l.charCodeAt(0) - 64;

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Statement");
  const grid = [];
  for (const [r, c, v, to] of cells) {
    ws.getCell(`${c}${r}`).value = v;
    if (to && to !== c) ws.mergeCells(`${c}${r}:${to}${r}`);
    (grid[r - 1] ??= [])[colNo(c) - 1] = v;
  }
  const base = `${out}/Sep2026_BilledStatements_7043_28-09-26`;
  await wb.xlsx.writeFile(`${base}.xlsx`);
  // CSV as Excel saves it: a merged area's value in its first cell only.
  const q = (v) => (v === undefined || v === null || v === "" ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = Array.from({ length: grid.length }, (_, i) => Array.from({ length: 25 }, (_, c) => q(grid[i]?.[c])).join(",")).join("\r\n");
  fs.writeFileSync(`${base}.csv`, csv + "\r\n");
  for (const ext of ["xlsx", "csv"]) console.log("wrote", `${base}.${ext}`, fs.statSync(`${base}.${ext}`).size, "bytes");
})();
