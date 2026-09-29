import { tableDate } from "@/components/table/Table";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The phone date: the month small and upper-case over the day ("SEP" / "22"),
 * as in the expense list. Screen readers get the full date.
 */
export function DateBadge({ iso }: { iso: string }) {
  const [, m, d] = iso.split("-").map(Number);
  return (
    <span className="inline-block w-9 shrink-0 text-center leading-tight">
      <span aria-hidden className="block text-[10px] uppercase text-muted">
        {MONTHS[(m ?? 1) - 1]}
      </span>
      <span aria-hidden className="block text-base font-semibold">
        {String(d).padStart(2, "0")}
      </span>
      <span className="sr-only">{tableDate(iso)}</span>
    </span>
  );
}
