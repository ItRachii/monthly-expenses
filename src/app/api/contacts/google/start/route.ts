import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isGroupIdShape } from "@/lib/contacts";
import { FLOW_COOKIE, appOrigin, consentUrl, newFlow } from "@/lib/googleContacts";

export const dynamic = "force-dynamic";

// Sends a signed-in member to Google to allow reading their contacts, then
// back to the group they came from (see the callback route).
export async function GET(req: NextRequest) {
  const origin = appOrigin(req.nextUrl.origin);
  const session = await auth();
  if (!session?.user?.email) return NextResponse.redirect(new URL("/login", origin));
  const group = req.nextUrl.searchParams.get("group");
  if (!isGroupIdShape(group) || !process.env.AUTH_GOOGLE_ID) return NextResponse.redirect(new URL("/", origin));

  const flow = newFlow();
  const res = NextResponse.redirect(consentUrl(origin, flow));
  res.cookies.set(FLOW_COOKIE, JSON.stringify({ s: flow.state, v: flow.verifier, g: group }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax: the cookie must come back on the redirect from Google.
    sameSite: "lax",
    path: "/api/contacts/google",
    maxAge: 600,
  });
  return res;
}
