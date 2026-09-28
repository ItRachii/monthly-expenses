# Card statement import: architecture

Single source of truth for how `/statements` turns a credit card PDF into
rows, summaries and EMI lineage. Bank layouts and their edge cases live in
one file per bank:

- [hdfc.md](./hdfc.md)
- [icici.md](./icici.md)

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
PDF ──pdf.js──▶ positioned text items ──lines.ts──▶ lines per page
   ──redact.ts──▶ allow-list + masking ──parse.ts──▶ rows, summary, card
   ──lineage.ts (browser)──▶ keyed hashes, GST traced to instalments on record
   ──actions──▶ expenses, card statement summary, EMI instalments
```

### 1. Text extraction (`lines.ts`, `pdf.ts`)

pdf.js gives text items with coordinates in drawing order. Items are
grouped into rows by their y position (tolerance 35% of the font size) and
joined by x gaps. The legacy pdf.js build is used in the browser because
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
one line, or a label row followed by a figure row. The card is identified
by its last four digits, from the masked number or from HDFC's file name,
never more.

### 4. Lineage (`lineage.ts`, browser)

- Loan numbers and references become stable keyed hashes (`applyKeys`), and
  the digits are dropped from memory.
- A lone GST charge is traced to an instalment on record (`resolveLineage`):
  exact by reference first; by date and 18% of interest only when no
  reference is printed and exactly one instalment fits.
- Earlier instalments not on record are reported, with the statement month
  to upload, derived from the instalment number and date.

### 5. Storage

| Table | Holds |
|---|---|
| `expenses` | Imported rows, paid by the user, split equally |
| `cards`, `card_statements` | One card per (user, bank, last four); one summary per (card, month) |
| `emi_instalments` | One row per (user, loan key, date): principal, interest, interest reference key, GST once billed, statement months |

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
- Scanned (image) PDFs are not read.
