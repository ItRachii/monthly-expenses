import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Defense-in-depth auth gate: every page already calls requireUser(), but this
// rejects unauthenticated requests at the edge before any server code runs.
export default auth((req) => {
  if (!req.auth?.user && req.nextUrl.pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  // Everything except the NextAuth routes, Next internals, the PWA shell, and
  // static assets (which must stay reachable for an installed offline app).
  matcher: [
    "/((?!api/auth|_next/static|_next/image|manifest.webmanifest|sw.js|offline|favicon.ico|icon-|apple-touch-icon|login-hero|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)",
  ],
};
