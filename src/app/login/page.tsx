import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { doSignIn } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <section className="flex flex-col justify-center px-8 py-16 md:px-16">
        <div className="text-6xl font-black leading-none tracking-[0.12em] text-ink">
          LEDGER
        </div>
        <p className="mt-4 text-muted">Track every expense, own every dollar.</p>
        <form action={doSignIn} className="mt-10">
          <button type="submit" className="btn-primary px-6 py-3 text-base">
            🔐&nbsp;&nbsp;Sign in with Google
          </button>
        </form>
      </section>

      <section className="hidden items-center justify-center border-l border-white/10 md:flex">
        <svg
          width="280"
          height="420"
          viewBox="0 0 200 310"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="100" cy="80" r="47" stroke="#FAFAFA" strokeWidth="2.8" fill="none" />
          <path d="M69 46 C63 34 68 23 77 26" stroke="#FAFAFA" strokeWidth="2.8" fill="none" strokeLinecap="round" />
          <path d="M100 33 C98 20 106 13 115 17" stroke="#FAFAFA" strokeWidth="2.8" fill="none" strokeLinecap="round" />
          <path d="M131 46 C138 34 133 23 124 26" stroke="#FAFAFA" strokeWidth="2.8" fill="none" strokeLinecap="round" />
          <circle cx="84" cy="76" r="5.5" fill="#FAFAFA" />
          <circle cx="116" cy="76" r="5.5" fill="#FAFAFA" />
          <path d="M100 90 L97 99 L100 103 L103 99 Z" fill="#FAFAFA" />
          <line x1="91" y1="125" x2="89" y2="146" stroke="#FAFAFA" strokeWidth="2.5" />
          <line x1="109" y1="125" x2="111" y2="146" stroke="#FAFAFA" strokeWidth="2.5" />
          <path d="M89 146 Q56 161 42 295" stroke="#FAFAFA" strokeWidth="2.8" fill="none" />
          <path d="M111 146 Q144 161 158 295" stroke="#FAFAFA" strokeWidth="2.8" fill="none" />
          <path d="M42 295 Q100 303 158 295" stroke="#FAFAFA" strokeWidth="2.8" fill="none" />
          <path d="M89 146 L78 178 L100 168" stroke="#FAFAFA" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
          <path d="M111 146 L122 178 L100 168" stroke="#FAFAFA" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
          <path d="M92 146 L100 160 L108 146" stroke="#FAFAFA" strokeWidth="2" fill="none" />
        </svg>
      </section>
    </main>
  );
}
