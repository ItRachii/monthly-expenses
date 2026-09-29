# Card statement import: architecture

Single source of truth for how `/statements` turns a credit card PDF into
rows, summaries and EMI lineage. Bank layouts and their edge cases live in
one file per bank:

- [hdfc.md](./hdfc.md)
- [icici.md](./icici.md)

Three file formats are read: PDF, Excel (.xlsx) and CSV. PDFs go through
text extraction and a line grammar. Spreadsheets are read as a grid, by
column header and cell label, which needs no guessing. Both end in the same
row builder, so EMI pairing, GST joins and forex markup follow one set of
rules.

Code: `src/lib/statements/` (pipeline), `src/lib/cards.ts` and
`src/lib/loans.ts` (storage), `src/app/(app)/statements/` (screen).
Tests: `npm run test:statements` (`tests/statements/run.ts`), which runs the
real pipeline against the fixture PDFs and the anonymised lines of real
statements. Add every new layout and edge case there.

## Privacy model

The PDF is read in the browser with pdf.js. It is never uploaded, and a
locked PDF's password stays on the page. What reaches the server is only
what the user chooses to add:

| Sent to the server | Never sent or stored |
|---|---|
| Date, cleaned description, amount and category of each imported row | The PDF, the password, the name and address block |
| Summary figures (dues, payments, limits, due date) | Full or masked card numbers beyond the last four digits |
| Last four digits of the card, bank, product name | Transaction references, loan numbers, phone, email, PAN, CKYC |
| Keyed hashes of loan numbers and references, last four digits of loan numbers | The digits behind those hashes |

The keyed hashes are HMAC-SHA256 under a salt the server derives from
`PII_SECRET` and the user id (`loanSaltFor` in `src/lib/loans.ts`). The
same loan or reference keys the same way in every statement of one user,
so joins are exact, and nobody without the secret can compute or reverse a
key. The salt is sent to the browser for that user only.

## Pipeline

```
PDF  ──pdf.js──▶ positioned text items ──lines.ts──▶ lines per page
     ──redact.ts──▶ allow-list + masking ──parse.ts──▶ transaction lines ─┐
XLSX ──exceljs (xlsx.ts)──▶ grid ─┐                                        ├─▶ buildRows ─▶ rows, summary, card
CSV  ──parseCsv (sheet.ts)──▶ grid ┴─▶ sheet.ts: header columns, labels ──┘
     ──lineage.ts (browser)──▶ keyed hashes, GST traced to instalments on record
     ──actions──▶ expenses, card statement summary, EMI instalments
```

### 1. Text extraction (`lines.ts`, `pdf.ts`)

pdf.js gives text items with coordinates in drawing order. Items are
grouped into rows by their y position (tolerance 35% of the font size) and
joined by x gaps. Each row also keeps where every item sits on the page
(`itemsToPage`), which the summary reader uses to pair figures with the
label printed above them; nothing else uses positions. The legacy pdf.js build is used in the browser because
its encrypted-file path needs `Map.prototype.getOrInsertComputed`, which
older phone browsers lack.

### 2. Redaction (`redact.ts`)

Runs before anything is parsed, kept or shown.

1. Allow-list: only section headings (7 words or fewer, naming a section)
   and lines that start with a date survive. The name and address block,
   contact details and the account summary never enter the parser.
2. Deny-list on the survivors: emails, masked and grouped card numbers,
   phones, PAN, and any unbroken run of 8 or more digits, even glued to
   letters (`IGST-VPS2723…`). A digit run becomes a per-parse pseudonym
   `[ref:xxxx]` (salted hash, fresh salt each parse) so equal numbers can
   still be paired within one statement.

The "Anonymised statement text" box on the screen shows exactly these
lines, plus canonical section labels and the summary labels and figure
rows. A section heading is reduced to its name because a heading can share
its line with the header column next to it.

### 3. Parsing (`parse.ts`, `summary.ts`, `dates.ts`)

One tolerant line grammar covers both banks:

```
<date>[|] [time] [serial] <description…> [points] [foreign amount] [₹|C] <amount> [Cr|+] [junk]
```

Rows are then built:

- **Domestic / international / EMI** by section heading or foreign currency.
- **Charges fold into what they belong to**, in this order of confidence:
  1. Exact: a GST line citing the `(Ref# …)` of a line in the statement.
  2. Adjacency: fee then GST, or EMI principal, interest, GST as neighbours.
  3. Amount ratio: forex markup 1% to 5.5% of an international purchase;
     GST 18% of a markup, or 18% of 3.5% of a purchase when the markup is
     inside the rate; GST 18% of an instalment's interest on the same date.
  A second pass (`resolveOrphans`) repeats this for charges printed before
  the line they belong to.
- What is left alone is `untraced`.
- Each row has a total, its parts, a suggested category, and for
  international rows the printed and effective exchange rates.

The summary box is read from labels and figures only (`summary.ts`): on
one line, or a label row followed by a figure row. With positions, a label
takes the first figure below it in its own column, which is what HDFC's
2026 box needs (see hdfc.md); from lines alone, figures follow labels in
reading order. The card is identified
by its last four digits, from the masked number or from HDFC's file name,
never more.

### 3b. Spreadsheets (`sheet.ts`, `xlsx.ts`)

A workbook is read with exceljs, loaded on first use like pdf.js. A CSV is
split by `parseCsv` (quotes, CRLF, comma, semicolon or tab). Both become a
grid of cells; the other cells of a merged area are blank.

- **Transaction table**: found by its header row. Every header cell must be
  a known column: date, description, amount, debit and credit, Dr/Cr,
  transaction type, foreign amount, or one that is never read (name,
  customer, rewards, reference, serial). The table ends at a title row or a
  row with no date.
- **What is read**: only the date, description, amount, Dr/Cr and type
  cells of each row. The description is redacted with the same deny-list as
  a PDF line before anything looks at it. The customer-name column, which
  holds the name and CKYC ID on HDFC's export, is never read.
- **Summary**: a cell whose text is a summary label, with its figure in the
  next cell to the right, else the cell below. Labels are not read inside
  reward-point, loan or GST blocks, whose "Opening Balance" or "Total" mean
  something else. A label whose value cell is blank is not a title.
- **Card**: only cells that mention "card" are passed on, for the last four
  digits.
- **Loan summary** and **GST summary** tables are read when present. Loans
  are shown on the EMI tab, with the loan number's last four digits only,
  and not stored. The GST summary's total is checked against the GST lines
  read, and a difference is a warning.
- Dates: `dd/mm/yyyy`, `dd Mon, yyyy`, ISO `yyyy-mm-dd`, and date cells.
  Amounts: numbers, Indian grouping, `₹`, `Cr`/`Dr` suffixes, a minus sign
  or brackets for credits.
- A password-protected workbook and old `.xls` files cannot be read; the
  screen says to save an unprotected `.xlsx` or CSV copy.

### 4. Lineage (`lineage.ts`, browser)

- Loan numbers and references become stable keyed hashes (`applyKeys`), and
  the digits are dropped from memory. Leading zeros are dropped before
  keying (`canonicalDigits`), because formats differ: the PDF prints a loan
  as `00000266258470`, the spreadsheet as `0 0000266258470`, its loan
  summary as the number `266258470`. A statement read from a PDF and the
  next one read from a spreadsheet therefore trace to each other.
- A lone GST charge is traced to an instalment on record (`resolveLineage`):
  exact by reference first; by date and 18% of interest only when no
  reference is printed and exactly one instalment fits.
- Earlier instalments not on record are reported, with the statement month
  to upload, derived from the instalment number and date.
- A GST charge that stays untraced can still be added. The import sends the
  cited reference's key with it (`untracedRefKey`), the server records it in
  `gst_pending`, and the expense shows a warning icon whose hover text and
  tap note say what is missing and which statement to upload. When that
  statement is uploaded, `saveLineage` ends with `resolvePendingGst`: the
  instalment whose reference key matches gets its GST, the expense is renamed
  to the lineage name (`GST on EMI #1 interest (loan …8470, Aug 2026)`) and
  the warning is cleared. Statements can therefore be uploaded in any order.

### 5. Storage

| Table | Holds |
|---|---|
| `expenses` | Imported rows, paid by the user, split equally |
| `cards`, `card_statements` | One card per (user, bank, last four); one summary per (card, month) |
| `emi_instalments` | One row per (user, loan key, date): principal, interest, interest reference key, GST once billed, statement months |
| `gst_pending` | GST charges added before their instalment was on record: expense, reference key, amount, date, statement month; `resolved_at` and the instalment once traced. Deleted with the expense |

Saving the same month again replaces it. Everything is filed under the
user's own id, never a group.

## Edge cases that hold across banks

- The `EMI` badge on a purchase means "eligible for conversion", not an
  instalment. It is dropped unless the line is an instalment itself.
- A "PAYMENT RECEIVED" transaction line must not be read as the summary's
  payments figure; summary parsing skips date-led lines.
- A merchant with the same name as a card product (Swiggy, Flipkart) must
  not become the product; the product only counts next to the word "card"
  in the header.
- Credits are shown but cannot be imported: expenses are positive.
- Importing the same statement twice creates the rows twice. Not solved.
  A pending GST charge imported twice is traced twice, to the same
  instalment, and both expenses are renamed.
- Tracing a pending GST charge renames the expense even if its description
  was edited in between. The amount, date and category are never touched.
- Scanned (image) PDFs are not read.
- Spreadsheet exports carry no foreign-currency amount on HDFC, so
  international rows from a spreadsheet show no exchange rate. The PDF has it.
- Add-on card rows are not told apart: the column that says whose card it
  was is the name column, which is never read.
