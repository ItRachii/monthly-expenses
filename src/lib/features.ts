import { emailId } from "./piiCrypto";

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
 * Developer tools: the scan inspector (/dev/scan) and the metrics page
 * (/dev/metrics). DEVELOPER_EMAILS is a comma-separated list of sign-in
 * addresses. Sessions carry the user id, not the address (see
 * src/lib/piiCrypto.ts), so each listed address is turned into its id the
 * same way. In development, with the list empty, every signed-in user counts.
 */
export async function isDeveloper(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const ids = await developerIds();
  if (ids.has(userId)) return true;
  return process.env.NODE_ENV !== "production" && ids.size === 0;
}

let cachedIds: { list: string; ids: Promise<Set<string>> } | null = null;

/** The user ids of everyone in DEVELOPER_EMAILS. */
export function developerIds(): Promise<Set<string>> {
  const list = process.env.DEVELOPER_EMAILS ?? "";
  if (cachedIds?.list !== list) {
    const emails = list.split(",").map((e) => e.trim()).filter(Boolean);
    cachedIds = { list, ids: Promise.all(emails.map((e) => emailId(e))).then((ids) => new Set(ids)) };
  }
  return cachedIds.ids;
}
