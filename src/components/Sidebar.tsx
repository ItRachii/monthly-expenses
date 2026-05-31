/* eslint-disable @next/next/no-img-element */
import { NavLinks } from "./NavLinks";
import { doSignOut } from "@/lib/actions/auth";

export function Sidebar({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-6 border-b border-white/10 bg-surface/40 p-4 md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center gap-3">
        {image ? (
          <img
            src={image}
            alt=""
            className="h-9 w-9 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-2xl">👤</span>
        )}
        <span className="truncate text-sm font-semibold">{name}</span>
      </div>

      <NavLinks />

      <form action={doSignOut} className="mt-auto">
        <button type="submit" className="btn-secondary w-full">
          Sign out
        </button>
      </form>
    </aside>
  );
}
