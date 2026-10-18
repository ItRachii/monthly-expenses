// Feature flags read on the server. New screens ship behind one so they can
// be merged and tested without changing what users see in production.

/**
 * Statement import (/statements). On in development; in production only when
 * STATEMENTS_ENABLED=1 is set. STATEMENTS_ENABLED=0 turns it off anywhere.
 */
export function statementsEnabled(): boolean {
  const v = process.env.STATEMENTS_ENABLED;
  if (v === "1") return true;
  if (v === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * Developer tools, such as the receipt scan inspector (/dev/scan). Only the
 * sign-in addresses in DEVELOPER_EMAILS (comma-separated) see them in
 * production; in development every signed-in user does.
 */
export function isDeveloper(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.DEVELOPER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.includes(email.trim().toLowerCase())) return true;
  return process.env.NODE_ENV !== "production" && list.length === 0;
}
