import { GitBranch } from "lucide-react";

export function HiveSignIn({ roomId }: { roomId: string }) {
  const returnTo = `/rooms/${roomId}`;
  return (
    <main className="grid min-h-dvh place-items-center bg-[#fafafa] px-6 text-[#171717]">
      <section className="w-full max-w-sm rounded-xl border border-[#e1e1e1] bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,0.06)]">
        <div className="grid size-9 place-items-center rounded-md bg-[#171717] text-white">
          <svg aria-hidden="true" className="size-6" fill="none" viewBox="0 0 24 24">
            <path d="M12 3.5 15 5.25v3.5l-3 1.75-3-1.75v-3.5L12 3.5ZM8 11l3 1.75v3.5L8 18l-3-1.75v-3.5L8 11Zm8 0 3 1.75v3.5L16 18l-3-1.75v-3.5L16 11Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.45" />
          </svg>
        </div>
        <h1 className="mt-6 text-xl font-semibold tracking-[-0.035em]">Join this Hive room</h1>
        <p className="mt-2 text-sm leading-6 text-[#737373]">
          One shared coding agent, one persistent workspace, and a clear record of who steered what.
        </p>
        <a
          className="mt-6 flex h-10 items-center justify-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white transition hover:bg-black"
          href={`/api/github/login?return_to=${encodeURIComponent(returnTo)}`}
        >
          <GitBranch className="size-4" /> Continue with GitHub
        </a>
      </section>
    </main>
  );
}
