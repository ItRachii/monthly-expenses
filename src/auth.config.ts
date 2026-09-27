import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { emailId } from "@/lib/piiCrypto";

// Auth.js v5 reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET from env.
// JWT session strategy means no database adapter or extra auth tables are
// needed. This part is shared with the edge middleware, so it must not import
// Node-only modules (Prisma, node:crypto); src/auth.ts adds the rest.
export const authConfig = {
  providers: [Google],
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // The app never handles the raw address after sign-in: session.user.email
    // is the user id that every table stores (see src/lib/piiCrypto.ts).
    async session({ session, token }) {
      if (session.user && typeof token.email === "string") {
        session.user.email = await emailId(token.email);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
