# ICICI Bank credit card statements

**Status: built from the known layout, not yet verified against a real
statement.** The synthetic fixture `tests/statements/fixtures/icici.pdf`
follows it. When a real statement is run, paste its anonymised text into a
fix and add the lines to `tests/statements/run.ts`.

## File and password

- The masked card number is printed in the header: `Card Number:
  4375XXXXXXXX9012`. The last four digits come from the text.
- The PDF is usually locked. The password is typically the first four
  letters of the name in capitals followed by the date of birth as DDMM.

## Layout as implemented

### Summary

"Label: value" lines:

```
Statement Date: August 12, 2026
Payment Due Date: September 1, 2026
Total Amount Due: Rs. 33,691.60
```

Dates in the `Month d, yyyy` form are read. Credit limit and minimum due
lines follow the same shape when present.

### Transaction lines

One table, `Transaction Details`, with a serial number column and an
international amount column:

```
Date        SerNo.       Transaction Details            Reward Points  Intl.# amount  Amount (in Rs.)
12/07/2026  10921307256  AMAZON PAY INDIA PRIVATE LI    12                            1,234.00
14/07/2026  10925553122  OPENAI *CHATGPT SUBSCR         0              20.00 USD      1,760.30
14/07/2026  10925553123  MARKUP FEE                     0                             61.61
14/07/2026  10925553124  IGST ON MARKUP FEE             0                             11.09
18/07/2026  10925553126  EMI PRINCIPAL 3/12 FLIPKART    0                             3,000.00
18/07/2026  10925553127  EMI INTEREST 3/12 FLIPKART     0                             420.00
18/07/2026  10925553128  IGST ON EMI INTEREST           0                             75.60
20/07/2026  10925553129  BBPS PAYMENT RECEIVED          0                             25,000.00 CR
```

| Feature | Handling |
|---|---|
| Serial number after the date | masked to a pseudonym and dropped from the description |
| Reward points before the amount | a trailing small integer is dropped |
| International amount `20.00 USD` (either order) | foreign currency and amount; rate = rupees / foreign |
| `MARKUP FEE` then `IGST ON MARKUP FEE` | markup 3.5% of the purchase, GST 18% of the markup, both folded into the purchase |
| `EMI PRINCIPAL 3/12`, `EMI INTEREST 3/12`, `IGST ON EMI INTEREST` | grouped by adjacency; "3/12" gives instalment 3 of 12; GST folds in the same statement |
| `CR` suffix | credit |
| No `(Ref# …)` references | GST joins by adjacency and amount; cross-statement lineage falls back to date and 18% of interest, refused when ambiguous |

## Edge cases expected but unverified

- A serial number of 8 or more digits directly after the year (`2026
  10921307256`) must not be read as one number. The digit-run rule does
  not bridge spaces.
- Whether ICICI bills the GST on EMI interest in the same statement (as
  the fixture assumes) or a month later like HDFC. If later, and without a
  reference, only the date-and-amount fallback can trace it.
- Whether the international amount column is ever printed without a
  currency code. Then the row still parses, but without a rate.
- The `Intl.# amount` header word "amount" must not be taken as a summary
  label; it is not, because the summary labels need a qualifier.
