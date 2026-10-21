## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.

## Docling scanning: change both parts together
- Any change to how scans are read (`docling-service/`, `src/lib/scanner/`, `src/lib/receipt/`, `src/app/api/scan/`) must reach both Add Expense (`src/app/(app)/add/ReceiptScanner.tsx`) and the developer inspector (`/dev/scan`, `src/app/(app)/dev/scan/ScanInspector.tsx`) in the same change.
- Both pages read through the shared readers in `src/lib/receipt/readOrder.ts` (`readOrderShots` for app orders, `readReceiptShots` for receipts). New reading logic goes there or below it, never into one page only.
- The inspector shows every step a scan goes through: what was found and why. A new step gets its own view there.
- Personal details (phones, addresses, names, emails) never leave `src/lib/scanner/client.ts` unmasked.
- A `docling-service/` change needs the user to rebuild the scanner image: say so. Test against the real Docling (2.140.0) when possible, not only with saved scans.
