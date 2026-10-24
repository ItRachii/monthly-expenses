"use server";

import { auth } from "@/auth";
import { recordScanEvent } from "@/lib/scanEvents";
import { clientMayReport, type ScanEventInput } from "@/lib/scanTracking";

/**
 * The few steps of a scanner attempt only the browser can see (images
 * picked, the read finished, what was changed before saving, a request that
 * never reached the server). Treated as hints: the user is the signed-in
 * one, only these events and fixed codes are accepted, and nothing here
 * can throw or change what the scanner does.
 */
export async function trackScanAction(input: ScanEventInput): Promise<void> {
  try {
    const email = (await auth())?.user?.email;
    if (!email || !input || typeof input !== "object" || !clientMayReport(input)) return;
    await recordScanEvent(input, email);
  } catch {
    // Tracking never gets in the way.
  }
}
