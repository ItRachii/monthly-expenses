# HDFC Bank credit card statements

Two layouts are handled. The 2026 layout is what current statements use
(seen on Millennia); the older layout is what the synthetic fixture
`tests/statements/fixtures/hdfc.pdf` follows.

## File and password

- File name carries the card's last four digits:
  `Sep2026_BilledStatements_7043_24-09-26_15.51.pdf`. The 2026 layout does
  not print a masked card number in the text, so the digits come from the
  file name (`cardIdentity`, `summary.ts`).
- The PDF is usually locked. The password is typically the first four
  letters of the name in capitals followed by the date of birth as DDMM.
  It is entered on the page and never leaves it.
- Product name ("Millennia") is taken only when printed next to "card" in
  the header.

## 2026 layout

### Summary box

What the eye sees:

```
PREVIOUS STATEMENT DUES  PAYMENTS/CREDITS  PURCHASES/DEBIT          FINANCE CHARGES | TOTAL AMOUNT DUE
                         RECEIVED          (Current Billing Cycle)                  | ₹27,236.00
₹63,817.22 − ₹63,817.00 + ₹27,235.51 + ₹0.00 =                                      |
TOTAL CREDIT LIMIT  AVAILABLE CREDIT LIMIT  AVAILABLE CASH LIMIT                    | MINIMUM DUE  DUE DATE
(Including Cash)                                                                    | ₹2,473.00    12 Oct, 2026
₹2,77,000           ₹2,38,992               ₹1,10,800                               |
```

What the text layer delivers, as rows grouped by y position. Labels are
vertically centred in their cells, so a two-line label sits above and
below the height of a one-line label next to it, and the labels of one
visual row arrive as three text rows. The big total is a row of its own,
and the right-hand box's figures land between the left-hand rows:

```
PAYMENTS/CREDITS PURCHASES/DEBIT
PREVIOUS STATEMENT DUES FINANCE CHARGES TOTAL AMOUNT DUE
RECEIVED (Current Billing Cycle)
₹63,817.22 − ₹63,817.00 + ₹27,235.51 + ₹0.00 = ₹27,236.00
TOTAL CREDIT LIMIT
AVAILABLE CREDIT LIMIT AVAILABLE CASH LIMIT MINIMUM DUE DUE DATE
(Including Cash)
₹2,473.00 12 Oct, 2026
₹2,77,000 ₹2,38,992 ₹1,10,800
```

Pairing figures with labels by reading order gets this wrong (previous
dues right, then finance charges = 63,817.00, total due = 27,235.51,
available credit = 2,473.00, the rest missing). So the summary is read by
column (`readRows` in `summary.ts`): each label takes the first figure
printed below it whose x range overlaps the label's, skipping continuation
rows and rows of other columns. The positions come from pdf.js through
`itemsToPage` (`lines.ts`); the anonymised lines shown on the screen are
unchanged. From lines alone, as in the tests' pasted statements, the
reading-order pairing is still used.

Edge cases in the box:

- In a narrow column "PREVIOUS STATEMENT" wraps over "DUES"; the label is
  recognised from "PREVIOUS STATEMENT" alone.
- The `Past Dues` table says "MINIMUM DUES", which is refused as a label
  (plural), so it can never fill the minimum due when the box did not.
- The operators `−`, `+`, `=` are text items between the figures and are
  ignored.

### Transaction lines

```
DATE & TIME        TRANSACTION DESCRIPTION                                        AMOUNT   PI
22/08/2026| 00:00  IGST-VPS5811462039786-RATE 18.0 -23 (Ref# 05555555520822779799514)  ₹ 34.74
04/09/2026| 08:32  CREDIT CARD PAYMENTNet Banking (Ref# 0000…3381)             + ₹ 63,817.00
13/09/2026| 08:05  [EMI] RAZ*IRCTChttps://www.                                   ₹ 14,074.55  ●
22/09/2026| 00:00  OFFUS EMI,PRIN NB:02,00000266258470 (Ref# 05555555520922779794911)  ₹ 996.00
22/09/2026| 00:00  OFFUS EMI,INT NBR:02,00000266258470 (Ref# 05555555520922779794945)  ₹ 167.00
```

What the text layer actually contains, and how each quirk is handled:

| Quirk | In the text layer | Handling |
|---|---|---|
| Date column ends with the separator, then a time column | `22/08/2026\| 00:00` or `23/08/2026 \| 03:51` | trailing `\|` stripped from the date; `\|` and `hh:mm` tokens skipped |
| Rupee sign is an invisible glyph | `C 34.74 l` (a `C` before, an `l` after) | up to two stray non-digit tokens after the amount are dropped; a lone `C`, `₹`, `Rs` before it is dropped |
| Credits carry a sign column | `+ C 63,817.00 l` | `+` marks a credit; `Cr` still works |
| **EMI badge** on purchases eligible for conversion | `EMI RAZ*IRCTC…`, `EMI ANTHROPIC*…` | dropped unless the next word is PRIN, INT, INSTAL, AMT, GST, CONV, PROC or FEE. Such purchases are charged in full: they add up to the statement's Purchases/Debit |
| Instalment lines | `OFFUS EMI,PRIN NB:02,<loan>` and `OFFUS EMI,INT NBR:02,<loan>` | paired by loan number pseudonym and instalment number, wherever printed; `NB:02` gives instalment #2 |
| EMI processing fee | `OFFUS EMI,PROCNG FEE,00000000003662` | a fee, not an instalment (the word FEE wins over EMI) |
| Every line cites a transaction reference | `(Ref# 05555555520822779799514)` | masked to a pseudonym; removed from descriptions; used for exact GST joins |
| Reward points column | absent in this layout | n/a |

### GST lineage

HDFC bills 18% GST on the interest part of an instalment, and on fees,
as separate `IGST-VPS…-RATE 18.0 -23` lines that **cite the exact `Ref#`
of the line they tax**:

- August statement: `OFFUS EMI,PROCNG FEE … (Ref# …848011) 299.00` and
  `IGST-VPS… (Ref# …848011) 53.82` on the same day. Joined exactly, in the
  statement.
- August statement: `OFFUS EMI,INT NBR:01 … (Ref# …4044689) 193.00`.
- September statement: `IGST-VPS… (Ref# …4044689) 34.74`, dated 22/08,
  the instalment's own date. The GST on an instalment's interest arrives
  **a month later**, with the earlier date, citing the interest line's
  reference. 34.74 is 18% of 193.

So:

1. Within a statement, a GST line citing a reference joins that line
   (interest, fee or markup) exactly.
2. Across statements, the September IGST is traced to August's instalment
   #1 through the reference's keyed hash stored with the instalment
   (`emi_instalments.ref_key`). Amount and date are a fallback only, and
   refused when ambiguous (two loans with the same interest on the same
   day cannot be told apart by amount).
3. If the cited reference is not on record, the charge is flagged
   `untraced`, and the screen asks for the statement that billed the
   instalment. Missing earlier instalments are also listed from the
   instalment number: `NB:02` with no #1 on record asks for the statement
   one month before.
   The charge can still be added. It is stored as an ordinary expense plus
   a `gst_pending` row holding the reference's key, and the expense shows a
   warning icon with the reason. Uploading the August statement later
   records instalment #1 with the same reference key, which traces the
   pending charge: instalment #1 gets `gst = 34.74`, the expense is renamed
   `GST on EMI #1 interest (loan …8470, Aug 2026)`, the icon goes. The
   September statement, uploaded first, is never re-imported.
4. A traced GST row is imported as its own expense, named
   `GST on EMI #1 interest (loan …8470, Aug 2026)`, so a friend who took
   the EMI on this card can be charged principal + interest + GST over
   the months it is actually billed. Nothing already settled is edited.

### Forex

International purchases show `USD 118.00` before the rupee amount. The
markup (`CONSOLIDATED FCY MARKUP FEE`, 3.5%) and its IGST (18% of the
markup) are separate lines, citing an `MT…` reference. The IGST for a
forex markup is printed under **Domestic Transactions**, before the
International section, so a second pass reattaches it by amount ratio.

## Excel download (.xlsx)

Named like the PDF: `Sep2026_BilledStatements_7043_28-09-26_21.43.xlsx`.
One sheet, `Statement`, with most cells merged across columns. Fixtures:
`Sep2026_BilledStatements_7043_28-09-26.xlsx` and the same sheet saved as
CSV, built by `make-sheet-fixtures.cjs` cell for cell from a real download
with every personal detail replaced.

```
A1  Name                    E1  <name>
A2  Address                 E2  <address line>
A3  Address                 E3  <city-pin state>        N3  Credit Card No.: 552233XXXXXX7043
A4  CKYC ID                 E4  <14 digits>             N4  Alternate Account Number: <19 digits>
A5  Customer GSTN           E5  (blank)
A6  Payment Due Date        E6  12 Oct, 2026
A7  Statement Date          E7  22 Sep, 2026
A8  Total Amount Due        E8  27,236.00               K8  Past Dues (If any)
A9  Minimum Amount Due      E9  2,473.00                K9…W9  Overlimit, 3 Months+, …, Minimum Amount Due
A10 Credit Limit            E10 2,77,000                K10…W10 0.00 … 2,473.00
A11 Available Limit         E11 2,38,992
A12 Available Cash Limit    E12 1,10,800
A14 Account Summary
A15 Opening Bal  E15 -  F15 Payment / Credit  J15 +  K15 Purchases / Debits  O15 +  P15 Finance Charges  T15 =  U15 Total Dues
A16 63,817.22       F16 63,817.00          K16 27,235.51            P16 0.00               U16 27,236.00
A19 Transaction type | E19 Primary / Addon Customer Name | J19 Date & Time | M19 Description | S19 REWARDS | U19 AMT | X19 Debit / Credit
A20 Domestic | E20 <name> [CKYC ID : <digits> ] | J20 22/08/2026 / 00:00 | M20 IGST-VPS…- RATE 18.0 -23 (Ref# …) | U20 34.74 | X20
…
A30 Reward Points Summary, A43 GST Summary (IGST CGST SGST Reversal Total), A49 Loan Summary
```

| Quirk | In the file | Handling |
|---|---|---|
| Labels with the value to the right | `Available Limit` in A11, figure in E11 | a label cell reads the next cell to the right; "Available Limit" is the available credit |
| Labels over figures | Account Summary row 15 over row 16, with `-`, `+`, `=` cells between | a label with no figure to its right reads the cell below it, within its own columns |
| Blank value | `Customer GSTN` with E5 empty | still a label, so reading continues below it |
| Opening balance twice | `Opening Bal` (account) and `Opening Balance` (reward points) | labels are not read inside reward, loan or GST blocks |
| Section per row | column A says `Domestic` or `International` | sets the row's section; no headings needed |
| Credits | `Cr` in the Debit / Credit column | credit |
| Customer name column | name and CKYC ID on every row | never read |
| Loan number split by a cell wrap | `OFFUS EMI,PRIN NB:02,0 0000266258470` | a lone digit group after a comma is joined to the digits that follow, then redacted; keys ignore leading zeros |
| Word split by a cell wrap | `CONSOLIDATED FCY MARKU P FEE` | the markup pattern accepts `MARKU P` and `FCY` |
| No foreign amount | the international purchase has only the rupee amount | no exchange rate from a spreadsheet |
| Loan summary | `Smart EMI`, loan number as a number cell, booked date, amount, tenure, rate, balances, months left | shown on the EMI tab with the last four digits only; not stored |
| GST summary | `IGST 105.92 … Total 105.92` | checked against the GST lines read (34.74 + 71.18) |
| No product name | the export never says "Millennia" | the card keeps the product a PDF gave it; a blank does not overwrite it |

The note under the GST summary, "GST levied on statement date is always
billed in the subsequent statement", is HDFC stating the one-month lag that
the lineage relies on.

CSV: HDFC's own CSV download has not been seen yet. The CSV fixture is the
Excel sheet saved as CSV, and reads identically. If HDFC's CSV differs,
paste its header row and a few anonymised lines into a fix.

## Older layout (fixture `hdfc.pdf`)

- `Card No: 4695 XXXX XXXX 1234` in the header; last four digits from the
  text.
- `Statement Date: 12/08/2026`, `Payment Due Date: 01/09/2026` on the
  header lines.
- Summary as a label row then a figure row: `Credit Limit  Available Credit
  Limit  Available Cash Limit  Total Dues  Minimum Amount Due`.
- Transaction lines `dd/mm/yyyy  description  [points]  amount [Cr]`,
  sections `Domestic Transactions` and `International Transactions`.
- EMI lines `EMI PRINCIPAL AMT 4 OF 12 CROMA`, `EMI INTEREST AMT 4 OF 12
  CROMA`, then `IGST-VPS…` adjacent: grouped by adjacency and the "4 OF 12"
  instalment.
- `IGST-VPS…` for forex markup under Domestic.

## Untested

- Statements with more than one card on the account.
- Reward points columns in the 2026 layout, if any.
- The `EMI` badge on international lines beyond the one case seen.
- Whether the interest reference is ever reused by a later GST line for a
  different purpose. The join assumes one GST per interest reference.
