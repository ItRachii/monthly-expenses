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

Label rows, a continuation row, then a figure row:

```
PREVIOUS STATEMENT DUES  PAYMENTS/CREDITS  PURCHASES/DEBIT  FINANCE CHARGES  TOTAL AMOUNT DUE
                         RECEIVED          (Current Billing Cycle)
₹63,817.22 − ₹63,817.00 + ₹27,235.51 + ₹0.00 = ₹27,236.00
TOTAL CREDIT LIMIT  AVAILABLE CREDIT LIMIT  AVAILABLE CASH LIMIT  MINIMUM DUE  DUE DATE
(Including Cash)
₹2,77,000 ₹2,38,992 ₹1,10,800 ₹2,473.00 12 Oct, 2026
```

Figures map to labels in order. The `Past Dues` row also says "MINIMUM
DUES", which must not overwrite the minimum due: the first occurrence wins
and the label regex refuses the plural.

### Transaction lines

```
DATE & TIME        TRANSACTION DESCRIPTION                                        AMOUNT   PI
22/08/2026| 00:00  IGST-VPS2723574016786-RATE 18.0 -23 (Ref# 09999999980822004044689)  ₹ 34.74
04/09/2026| 08:32  CREDIT CARD PAYMENTNet Banking (Ref# 0000…3381)             + ₹ 63,817.00
13/09/2026| 08:05  [EMI] RAZ*IRCTChttps://www.                                   ₹ 14,074.55  ●
22/09/2026| 00:00  OFFUS EMI,PRIN NB:02,00000144148470 (Ref# 09999999980922004049488)  ₹ 996.00
22/09/2026| 00:00  OFFUS EMI,INT NBR:02,00000144148470 (Ref# 09999999980922004049496)  ₹ 167.00
```

What the text layer actually contains, and how each quirk is handled:

| Quirk | In the text layer | Handling |
|---|---|---|
| Date column ends with the separator, then a time column | `22/08/2026\| 00:00` or `23/08/2026 \| 03:51` | trailing `\|` stripped from the date; `\|` and `hh:mm` tokens skipped |
| Rupee sign is an invisible glyph | `C 34.74 l` (a `C` before, an `l` after) | up to two stray non-digit tokens after the amount are dropped; a lone `C`, `₹`, `Rs` before it is dropped |
| Credits carry a sign column | `+ C 63,817.00 l` | `+` marks a credit; `Cr` still works |
| **EMI badge** on purchases eligible for conversion | `EMI RAZ*IRCTC…`, `EMI ANTHROPIC*…` | dropped unless the next word is PRIN, INT, INSTAL, AMT, GST, CONV, PROC or FEE. Such purchases are charged in full: they add up to the statement's Purchases/Debit |
| Instalment lines | `OFFUS EMI,PRIN NB:02,<loan>` and `OFFUS EMI,INT NBR:02,<loan>` | paired by loan number pseudonym and instalment number, wherever printed; `NB:02` gives instalment #2 |
| EMI processing fee | `OFFUS EMI,PROCNG FEE,00000000001441` | a fee, not an instalment (the word FEE wins over EMI) |
| Every line cites a transaction reference | `(Ref# 09999999980822004044689)` | masked to a pseudonym; removed from descriptions; used for exact GST joins |
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
