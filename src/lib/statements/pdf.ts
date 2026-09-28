// In-browser PDF text extraction with pdf.js. The file is read entirely on
// the device: nothing is uploaded, and the statement password never leaves
// the page. The library and its worker load lazily on first use, so the
// main bundle does not carry them.

import { itemsToPage, type PageText, type PositionedText } from "./lines";

export class PdfPasswordError extends Error {
  constructor(public readonly wrong: boolean) {
    super(wrong ? "Wrong password." : "This PDF needs a password.");
  }
}

/** Each page's lines in reading order, with their positions. */
export async function readPdfPages(file: File, password?: string): Promise<PageText[]> {
  // The legacy build carries polyfills for the newest JavaScript methods
  // pdf.js uses (its encrypted-file path needs Map.getOrInsertComputed),
  // so it works on phone browsers and older desktops too.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, password });
  try {
    const doc = await task.promise;
    const pages: PageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items = content.items.filter((it): it is PositionedText & typeof it => "str" in it);
      pages.push(itemsToPage(items));
      page.cleanup();
    }
    return pages;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err?.name === "PasswordException") {
      throw new PdfPasswordError(err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    }
    throw e;
  } finally {
    await task.destroy();
  }
}
