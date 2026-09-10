import { cn } from "@/lib/utils";

export function HiveMark({ className, light = false }: { className?: string; light?: boolean }) {
  return <span aria-label="Hive logo" className={cn("grid size-8 shrink-0 place-items-center rounded-md", light ? "bg-[#ededed] text-[#171717]" : "bg-[#171717] text-white", className)} role="img">
    <svg aria-hidden="true" className="size-[68%]" fill="none" viewBox="0 0 24 24"><path d="M12 3.5 15 5.25v3.5l-3 1.75-3-1.75v-3.5L12 3.5ZM8 11l3 1.75v3.5L8 18l-3-1.75v-3.5L8 11Zm8 0 3 1.75v3.5L16 18l-3-1.75v-3.5L16 11Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.45" /></svg>
  </span>;
}
