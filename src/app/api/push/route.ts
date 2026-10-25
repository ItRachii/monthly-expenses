import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { savePushSubscription, vapidPublicKey } from "@/lib/push";
import { parseSubscription } from "@/lib/pushPayload";

// POST /api/push { subscription }
// Saves this device's push subscription for the signed-in user. The app
// sends it whenever notifications are allowed, so a device that signs in
// as someone else, or whose subscription the browser renewed, catches up.
async function signedIn(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

export async function POST(req: Request) {
  const userId = await signedIn();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!vapidPublicKey()) return NextResponse.json({ error: "Notifications are not set up." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { subscription?: unknown } | null;
  const sub = parseSubscription(body?.subscription);
  if (!sub) return NextResponse.json({ error: "Not a push subscription." }, { status: 400 });
  await savePushSubscription(userId, sub);
  return NextResponse.json({ ok: true });
}
