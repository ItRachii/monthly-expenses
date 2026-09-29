"use client";

import { useState } from "react";
import { XIcon } from "@/components/Icons";

// Excel export: full history, or a date range. The file itself is built
// server-side by /api/export so no spreadsheet code ships to the browser.
export function ExportButton({
  ctx,
  minDate,
  maxDate,
  className = "btn-secondary",
  children = "Export to Excel",
}: {
  ctx: string;
  minDate: string;
  maxDate: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "range">("all");
  const [from, setFrom] = useState(minDate);
  const [to, setTo] = useState(maxDate);
  const invalid = mode === "range" && (!from || !to || from > to);

  function download() {
    const q = new URLSearchParams({ ctx });
    if (mode === "range") {
      q.set("from", from);
      q.set("to", to);
    }
    // The response is an attachment, so navigating to it downloads in place.
    window.location.assign(`/api/export?${q.toString()}`);
    setOpen(false);
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>

      {open ? (
        <div
          className="sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Export to Excel"
            onClick={(e) => e.stopPropagation()}
            className="sheet card w-full space-y-4 rounded-b-none md:max-w-md md:rounded-xl"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-center justify-between">
              <h2 className="section-title">Export to Excel</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
                <XIcon />
              </button>
            </div>
            <p className="text-xs text-muted">
              One workbook: a Summary sheet, then a sheet per month.
            </p>

            <label className="flex cursor-pointer items-center gap-3">
              <input type="radio" name="range" checked={mode === "all"} onChange={() => setMode("all")} />
              <span>Full history</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input type="radio" name="range" checked={mode === "range"} onChange={() => setMode("range")} />
              <span>Date range</span>
            </label>

            {mode === "range" ? (
              <div className="grid grid-cols-2 gap-3 pl-7">
                <div>
                  <label className="label">From</label>
                  <input type="date" className="input" value={from} min={minDate} max={maxDate} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div>
                  <label className="label">To</label>
                  <input type="date" className="input" value={to} min={minDate} max={maxDate} onChange={(e) => setTo(e.target.value)} />
                </div>
                {invalid ? (
                  <div className="col-span-2 alert-error">Pick a valid range: From must be on or before To.</div>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={download} disabled={invalid}>
                Download .xlsx
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
