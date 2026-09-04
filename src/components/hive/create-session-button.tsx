"use client";

import { ArrowUpRight } from "lucide-react";
import { useFormStatus } from "react-dom";

export function CreateSessionButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-label="Create task session"
      className="grid size-10 shrink-0 place-items-center rounded-md bg-[#171717] text-white transition hover:bg-black disabled:cursor-wait disabled:opacity-50"
      disabled={pending}
      type="submit"
    >
      <ArrowUpRight className="size-4" />
    </button>
  );
}
