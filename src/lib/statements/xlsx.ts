// Reads an .xlsx workbook into grids with exceljs. Runs on the device: the
// library loads on first use, so the main bundle does not carry it, and the
// file is never uploaded.

import type { CellValue, Grid } from "./sheet";

export class SheetReadError extends Error {}

type RawValue = unknown;

function plain(v: RawValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: RawValue; text?: RawValue; error?: string };
    if (Array.isArray(o.richText)) return o.richText.map((x) => x.text).join("");
    if ("result" in o) return plain(o.result);
    if ("text" in o) return plain(o.text);
    if (o.error) return null;
  }
  return null;
}

/** Every worksheet of a workbook, as grids. */
export async function readXlsx(data: ArrayBuffer): Promise<Grid[]> {
  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new SheetReadError(
      "Could not open this spreadsheet. If it is password protected, open it, save a copy without a password, and choose that copy. Old .xls files are not supported: save as .xlsx or CSV.",
    );
  }
  const grids: Grid[] = [];
  wb.eachSheet((ws) => {
    const grid: Grid = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const out: CellValue[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const cell = row.getCell(c);
        // The other cells of a merged area repeat its value: keep the first only.
        out.push(cell.type === ExcelJS.ValueType.Merge ? null : plain(cell.value));
      }
      grid.push(out);
    }
    grids.push(grid);
  });
  return grids;
}
