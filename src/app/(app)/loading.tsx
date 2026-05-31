// Shown instantly on navigation between pages in this group while the server
// component fetches its data. Keeps the sidebar in place and avoids the "frozen
// on the old page" feel. Also lets <Link> prefetch a loading state for these
// force-dynamic routes.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-48 rounded bg-white/10" />
      <div className="h-10 w-full max-w-xs rounded bg-white/10" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 w-full rounded-lg bg-white/10" />
        ))}
      </div>
    </div>
  );
}
