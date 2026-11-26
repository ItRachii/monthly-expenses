import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isGroupIdShape } from "@/lib/contacts";
import { FLOW_COOKIE, TOKEN_COOKIE, appOrigin, exchangeCode, sealToken } from "@/lib/googleContacts";

export const dynamic = "force-dynamic";

// Google sends the member back here. On success the access token is kept in
// an encrypted cookie and the group opens with the contact list; otherwise
// the group opens saying contacts were not shared.
export async function GET(req: NextRequest) {
  const origin = appOrigin(req.nextUrl.origin);
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.redirect(new URL("/login", origin));

  let flow: { s?: unknown; v?: unknown; g?: unknown } = {};
  try {
    flow = JSON.parse(req.cookies.get(FLOW_COOKIE)?.value ?? "{}");
  } catch {
    // An unreadable cookie is treated as no flow in progress.
  }
  const back = (result: "1" | "denied") => {
    const to = isGroupIdShape(flow.g) ? `/g/${flow.g}?contacts=${result}` : "/";
    const res = NextResponse.redirect(new URL(to, origin));
    res.cookies.set(FLOW_COOKIE, "", { path: "/api/contacts/google", maxAge: 0 });
    return res;
  };

  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  // The state must be the one this browser started with.
  if (!code || typeof flow.s !== "string" || typeof flow.v !== "string" || sp.get("state") !== flow.s) return back("denied");

  let token: Awaited<ReturnType<typeof exchangeCode>> = null;
  try {
    token = await exchangeCode(code, flow.v, origin);
  } catch (e) {
    console.error("[contacts] token exchange failed:", e instanceof Error ? e.message : e);
  }
  if (!token) return back("denied");

  const res = back("1");
  res.cookies.set(TOKEN_COOKIE, sealToken(token.accessToken, userId, token.expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(token.expiresAt),
  });
  return res;
}
