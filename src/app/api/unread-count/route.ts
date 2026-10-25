import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUnreadCount } from "@/lib/notifications";

// GET /api/unread-count
// The signed-in user's unread notifications, so the home-screen icon badge
// can catch up when the app comes back to the foreground without
// re-rendering the page.
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const count = await getUnreadCount(email);
  return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
