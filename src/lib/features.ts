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
