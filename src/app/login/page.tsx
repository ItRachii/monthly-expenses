import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { doSignIn } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

function Logo() {
  return (
    <div className="flex items-center gap-2 text-ink">
      <svg viewBox="0 0 40 40" className="h-8 w-8" fill="none" aria-hidden>
        <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" />
        <path d="M4 20a16 16 0 0 0 32 0Z" fill="currentColor" />
      </svg>
      <span className="text-lg font-bold tracking-tight">.Finance</span>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4 sm:p-6">
      {/* Ambient gradient glows behind the card. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute -right-40 bottom-0 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-surface shadow-2xl md:grid-cols-2">
        {/* LEFT — sign in */}
        <section className="flex flex-col justify-center gap-8 px-8 py-14 sm:px-12">
          <Logo />

          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-ink">Welcome Back!</h1>
            <p className="text-sm text-muted">
              Sign in with Google to continue to your dashboard.
            </p>
          </div>

          <form action={doSignIn}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white px-4 py-3.5 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-white/90"
            >
              <GoogleIcon />
              Log in with Google
            </button>
          </form>

          <p className="text-xs text-muted">
            New here? Signing in with Google creates your account
            automatically.
          </p>
        </section>

        {/* RIGHT — marketing panel */}
        <section className="relative hidden flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[#0a0a0a] via-[#0b0f12] to-emerald-950/50 p-10 md:flex">
          {/* Floating decorative shapes. */}
          <div
            aria-hidden
            className="absolute left-12 top-16 h-10 w-10 rotate-45 rounded-md bg-gradient-to-br from-violet-400 to-violet-600 shadow-[0_0_45px_rgba(139,124,246,0.65)]"
          />
          <div
            aria-hidden
            className="absolute right-16 top-24 h-5 w-5 rotate-12 rounded-sm bg-yellow-400 shadow-[0_0_25px_rgba(250,204,21,0.6)]"
          />
          <div
            aria-hidden
            className="absolute bottom-32 right-10 h-16 w-16 rounded-full border-[10px] border-emerald-400 shadow-[0_0_45px_rgba(52,211,153,0.55)]"
          />
          <div
            aria-hidden
            className="absolute bottom-36 left-14 h-0 w-0 rotate-[200deg] border-x-[12px] border-b-[20px] border-x-transparent border-b-lime-400 drop-shadow-[0_0_10px_rgba(163,230,53,0.6)]"
          />

          <div className="relative z-10 flex flex-col items-center">
            {/* Hexagon hero (stand-in for the 3D illustration). */}
            <div className="relative h-64 w-60">
              <svg
                viewBox="0 0 220 240"
                className="h-full w-full drop-shadow-[0_0_30px_rgba(76,114,176,0.45)]"
                aria-hidden
              >
                <defs>
                  <linearGradient id="hex" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#8B7CF6" />
                    <stop offset="100%" stopColor="#34D399" />
                  </linearGradient>
                </defs>
                <polygon
                  points="110,10 205,65 205,175 110,230 15,175 15,65"
                  fill="url(#hex)"
                  fillOpacity="0.07"
                  stroke="url(#hex)"
                  strokeWidth="2.5"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-[7rem] leading-none">
                🧑‍💻
              </div>
            </div>

            <h2 className="mt-8 text-center text-2xl font-bold text-ink sm:text-3xl">
              Manage your Money Anywhere
            </h2>
            <p className="mt-3 max-w-xs text-center text-sm text-muted">
              Track expenses, splits, and settlements on the go — from any
              device.
            </p>

            {/* Carousel dots (decorative). */}
            <div className="mt-6 flex items-center gap-2 rounded-full bg-white/10 px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-white/25" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="h-2 w-2 rounded-full bg-white/25" />
            </div>
          </div>

          {/* Real artwork: when public/login-hero.png exists it covers the panel;
              until then this paints nothing and the CSS composition shows. */}
          <div
            aria-hidden
            style={{ backgroundImage: "url('/login-hero.png')" }}
            className="absolute inset-0 z-20 bg-cover bg-center"
          />
        </section>
      </div>
    </main>
  );
}
