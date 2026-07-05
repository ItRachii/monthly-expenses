import { redirect } from "next/navigation";

// Settlement merged into the per-context screen — keep old links working.
export default async function SettlementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = typeof sp.ctx === "string" && sp.ctx ? sp.ctx : "personal";
  redirect(`/g/${encodeURIComponent(ctx)}?tab=balances`);
}
