"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "@/components/Icons";

export interface DropdownOption {
  value: string;
  label: string;
}

const MAX_HEIGHT = 240;

/**
 * A select that opens a short overlay under the field (or above it when
 * there is no room), instead of the phone's full-screen picker. Looks like
 * the `.select` field; the list scrolls inside its own box. Keyboard: arrows
 * move, Enter picks, Escape closes (and does not close a dialog around it).
 */
export function Dropdown({
  id,
  value,
  options,
  onChange,
  className = "",
}: {
  id?: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; max: number } | null>(null);
  const current = options.find((o) => o.value === value);

  function show() {
    const r = button.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < Math.min(MAX_HEIGHT, options.length * 44) && above > below;
    setBox({
      left: r.left,
      width: r.width,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      max: Math.max(120, Math.min(MAX_HEIGHT, up ? above : below)),
    });
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function pick(o: DropdownOption) {
    setOpen(false);
    button.current?.focus();
    if (o.value !== value) onChange(o.value);
  }

  // Close on a press outside, on a resize, or when something behind scrolls.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Keep the chosen row in view.
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) pick(options[active]);
    } else if (e.key === "Tab") setOpen(false);
  }

  return (
    <>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={`select flex items-center justify-between gap-2 text-left ${className}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted" fill="currentColor">
          <path d="M5.5 7.5 10 12l4.5-4.5-1-1L10 10 6.5 6.5z" />
        </svg>
      </button>
      {open && box
        ? createPortal(
            <ul
              ref={list}
              id={listId}
              role="listbox"
              className="fixed z-[70] overflow-y-auto overscroll-contain rounded-lg border border-ink/10 bg-surface py-1 shadow-xl"
              style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.max }}
            >
              {options.map((o, i) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm ${
                    i === active ? "bg-ink/10" : ""
                  } ${o.value === value ? "font-semibold" : ""}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                >
                  <span className="min-w-0 truncate">{o.label}</span>
                  {o.value === value ? <CheckIcon className="h-4 w-4 shrink-0 text-primary" /> : null}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
