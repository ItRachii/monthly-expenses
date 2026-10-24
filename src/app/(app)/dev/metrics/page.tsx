import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { isDeveloper } from "@/lib/features";
import { loadMetrics, type Metrics } from "@/lib/metrics/queries";
import { loadScanMetrics } from "@/lib/metrics/scan";
import { MetricsView } from "./MetricsView";

// Developer-only product metrics: is the app growing, do people come back,
// what do they use? Counts only, from user ids; no one is named. Anyone not
// in DEVELOPER_EMAILS gets a plain 404, and nothing links here.

export const dynamic = "force-dynamic";

export default async function DevMetricsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!(await isDeveloper(user.email))) notFound();
  const includeDevelopers = (await searchParams).dev === "1";

  let m: Metrics;
  try {
    m = await loadMetrics({ includeDevelopers });
  } catch (e) {
    console.error("Metrics failed to load:", e);
    return (
      <div className="space-y-4">
        <h1>Product metrics</h1>
        <div className="alert-error">The metrics could not be loaded. The server log has the error.</div>
      </div>
    );
  }
  // The scanner's usage is its own section: it failing to load leaves the rest of the page.
  const scan = await loadScanMetrics({ includeDevelopers }).catch((e) => {
    console.error("Scanner metrics failed to load:", e);
    return null;
  });
  return <MetricsView m={m} scan={scan} />;
}
