import { GitBranch } from "lucide-react";
import Link from "next/link";

export function HiveSignIn({
  description = "One shared coding agent, one task, and a clear record of who steered what.",
  returnTo,
  title = "Continue to Hive",
}: {
  description?: string;
  returnTo: string;
  title?: string;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#fafafa] px-6 text-[#171717]">
      <section className="w-full max-w-sm rounded-xl border border-[#e1e1e1] bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,0.06)]">
        <div className="grid size-9 place-items-center rounded-md bg-[#171717] text-white">
          <svg aria-hidden="true" className="size-6" fill="none" viewBox="0 0 24 24">
            <path d="M12 3.5 15 5.25v3.5l-3 1.75-3-1.75v-3.5L12 3.5ZM8 11l3 1.75v3.5L8 18l-3-1.75v-3.5L8 11Zm8 0 3 1.75v3.5L16 18l-3-1.75v-3.5L16 11Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.45" />
          </svg>
        </div>
        <h1 className="mt-6 text-xl font-semibold tracking-[-0.035em]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#737373]">
          {description}
        </p>
        <a
          className="mt-6 flex h-10 items-center justify-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white transition hover:bg-black"
          href={`/api/github/login?return_to=${encodeURIComponent(returnTo)}`}
        >
          <GitBranch className="size-4" /> Continue with GitHub
        </a>
        <Link
          className="mt-3 flex min-h-10 items-center justify-center rounded-md border border-[#e1e1e1] px-4 py-2 text-sm font-medium transition hover:bg-[#fafafa] focus-visible:outline-2 focus-visible:outline-offset-2"
          href="/demo"
          prefetch={false}
        >
          Explore demo
        </Link>
        <p className="mt-2 text-center text-xs leading-5 text-[#737373]">No sign-in required. Sample data only.</p>
      </section>
    </main>
  );
}
