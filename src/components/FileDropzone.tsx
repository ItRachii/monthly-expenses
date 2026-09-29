"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileUploadIcon } from "./Icons";

/** True when a file matches an `accept` list: ".pdf", "image/*" or "text/csv". */
export function accepts(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return accept
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((a) => (a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a));
}

/**
 * A drop zone for files: click anywhere to pick, or drag files onto it. The
 * edge lights up on hover and while a file is dragged over it. Files are
 * handed to `onFiles` as they are; nothing here uploads anything.
 */
export function FileDropzone({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  onReject,
  action = "to upload your file",
  hint,
  label,
  children,
}: {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  /** Called with the dropped files that `accept` rules out. */
  onReject?: (files: File[]) => void;
  /** The words after "Click here", before " or drag." (dropped on touch screens). */
  action?: string;
  /** Supported formats and limits, under the main line. */
  hint?: ReactNode;
  /** Accessible name of the file input. */
  label: string;
  /** Shown under the hint: the chosen file, a status line. */
  children?: ReactNode;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter and dragleave fire for every child; count them to know when
  // the pointer has really left the zone.
  const depth = useRef(0);

  function take(list: FileList | null) {
    const all = Array.from(list ?? []);
    if (all.length === 0) return;
    const ok = all.filter((f) => accepts(f, accept));
    const bad = all.filter((f) => !accepts(f, accept));
    if (bad.length > 0) onReject?.(bad);
    if (ok.length > 0) onFiles(multiple ? ok : ok.slice(0, 1));
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <label
      htmlFor={inputId}
      data-dragging={dragging || undefined}
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        take(e.dataTransfer.files);
      }}
      className={`group relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 px-6 py-8 text-center transition-[border-color,box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none ${
        disabled
          ? "cursor-wait border-white/10 opacity-60"
          : dragging
            ? // One border class per state: two would fight and the fainter could win.
              "cursor-copy border-primary bg-primary/[0.08] shadow-[0_0_0_5px_rgba(76,114,176,0.25),0_0_36px_rgba(76,114,176,0.45)]"
            : "cursor-pointer border-primary/35 hover:border-primary hover:bg-primary/[0.04] hover:shadow-[0_0_0_4px_rgba(76,114,176,0.18),0_0_28px_rgba(76,114,176,0.35)] focus-within:border-primary focus-within:shadow-[0_0_0_4px_rgba(76,114,176,0.28)]"
      }`}
    >
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        className="sr-only"
        onChange={(e) => {
          take(e.target.files);
          // Choosing the same file again must still fire a change.
          e.target.value = "";
        }}
      />
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary-light transition-transform duration-200 ease-out motion-reduce:transition-none ${
          disabled ? "" : "group-hover:scale-105"
        } ${dragging ? "-translate-y-0.5 scale-110" : ""}`}
      >
        <FileUploadIcon className="h-5 w-5" />
      </span>
      <span className="text-sm text-ink">
        {dragging ? (
          <span className="font-semibold text-primary-light">Drop to add it</span>
        ) : (
          <>
            {/* Touch screens tap and cannot drag files in: say so. */}
            <span className="font-semibold text-primary-light">
              <span className="[@media(pointer:coarse)]:hidden">Click here</span>
              <span className="hidden [@media(pointer:coarse)]:inline">Tap here</span>
            </span>{" "}
            {action}
            <span className="[@media(pointer:coarse)]:hidden"> or drag</span>.
          </>
        )}
      </span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      {children}
    </label>
  );
}
