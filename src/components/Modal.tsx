"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * A modal window on the native <dialog>, opened with showModal() while it is
 * mounted. The browser provides what custom overlays rebuild by hand: the page
 * behind goes inert, focus stays inside, Esc and the phone's back gesture
 * close it, and focus returns to the control that opened it. A press outside
 * the window closes it too.
 *
 * Every way of closing ends in onClose; the parent then unmounts the Modal.
 * Give the window a heading and pass its id as labelledBy, or, with no
 * visible title, a label. sheet: a bottom
 * sheet on phones (full width, at the bottom), centred from md up. width: the
 * window's width where it is centred (default 28rem). Put data-autofocus on
 * the field focus should start on (React's autoFocus does not work here).
 * dismissible={false}: a press outside does not close it (Esc still does).
 * keepOpen: Esc and the back gesture are ignored for now, e.g. while saving.
 * alert: a confirmation of something destructive (role alertdialog);
 * describedBy names the text that explains what happens.
 */
export function Modal({
  labelledBy,
  label,
  onClose,
  sheet = false,
  width,
  dismissible = true,
  keepOpen = false,
  alert = false,
  describedBy,
  className = "",
  children,
}: {
  labelledBy?: string;
  label?: string;
  onClose: () => void;
  sheet?: boolean;
  width?: string;
  dismissible?: boolean;
  keepOpen?: boolean;
  alert?: boolean;
  describedBy?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const keepOpenRef = useRef(keepOpen);
  keepOpenRef.current = keepOpen;

  // Layout effect: open before paint, and on unmount close while the dialog is
  // still in the page, so the browser returns focus to the opener.
  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    // React's autoFocus runs while the dialog is still closed, where nothing
    // can take focus, so mark the field to start on with data-autofocus
    // instead; without one, the browser focuses the first control.
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onCloseEvent = () => closeRef.current();
    dialog.addEventListener("close", onCloseEvent);
    // cancel fires for Esc and the back gesture.
    const onCancel = (e: Event) => {
      if (keepOpenRef.current) e.preventDefault();
    };
    dialog.addEventListener("cancel", onCancel);

    // A press outside closes it: tested against the window's box here, not
    // with closedby="any", which Safari lacks and which in Chrome also closes
    // on the release of a press that began before the window opened (a long
    // press that opens a sheet). Press and release must both land outside
    // after it opened, so a text selection dragged onto the backdrop stays.
    let cleanupPointer = () => {};
    if (dismissible) {
      const outside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      const down = (e: PointerEvent) => (pressedOutside = outside(e));
      const up = (e: PointerEvent) => {
        if (pressedOutside && outside(e) && !keepOpenRef.current) dialog.close();
      };
      dialog.addEventListener("pointerdown", down);
      dialog.addEventListener("pointerup", up);
      cleanupPointer = () => {
        dialog.removeEventListener("pointerdown", down);
        dialog.removeEventListener("pointerup", up);
      };
    }

    return () => {
      dialog.removeEventListener("close", onCloseEvent);
      dialog.removeEventListener("cancel", onCancel);
      cleanupPointer();
      if (dialog.open) dialog.close();
    };
    // dismissible is read once: a window doesn't change how it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-label={label}
      aria-describedby={describedBy}
      role={alert ? "alertdialog" : undefined}
      style={width ? ({ "--modal-width": width } as React.CSSProperties) : undefined}
      className={`modal ${sheet ? "modal-sheet" : ""} text-ink ${className}`}
    >
      {children}
    </dialog>
  );
}
