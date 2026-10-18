import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { isDeveloper } from "@/lib/features";
import { ScanInspector } from "./ScanInspector";

// Developer-only view of how a receipt is read, end to end: the same route,
// tunnel, scanner and parser as the scan screen, with every step shown.
// Anyone not in DEVELOPER_EMAILS gets a plain 404, and nothing links here.
export default async function DevScanPage() {
  const user = await requireUser();
  if (!isDeveloper(user.email)) notFound();
  return (
    <div className="space-y-4">
      <h1>Scan inspector</h1>
      <p className="text-sm text-muted">
        Developer view. Runs one image through the real scanner and parser and shows each step. Nothing is saved.
      </p>
      <ScanInspector />
    </div>
  );
}
