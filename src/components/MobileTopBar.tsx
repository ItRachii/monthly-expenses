import Link from "next/link";
import { UserAvatar } from "./UserAvatar";
import { NotificationsIcon } from "./NavIcons";

// Mobile-only top bar (the desktop sidebar covers md+). Notifications and the
// profile avatar sit at the top-right and show on every app page.
export function MobileTopBar({
  image,
  unreadCount,
}: {
  image: string | null;
  unreadCount: number;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink/10 bg-background/80 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur md:hidden">
      <span className="text-base font-bold">Ledger</span>
      <div className="flex items-center gap-1">
        <Link
          href="/notifications"
          aria-label="Notifications"
          className="relative grid h-11 w-11 place-items-center rounded-lg text-2xl leading-none transition hover:bg-ink/5"
        >
          <span aria-hidden>
            <NotificationsIcon />
          </span>
          {unreadCount > 0 ? (
            <span className="absolute right-1 top-1 grid h-4 min-w-[1rem] place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Link>
        <Link
          href="/profile"
          aria-label="Profile"
          className="-m-1 shrink-0 rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <UserAvatar image={image} className="h-9 w-9" />
        </Link>
      </div>
    </header>
  );
}
