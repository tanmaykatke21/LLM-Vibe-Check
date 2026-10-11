"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Top navigation (Docs added Oct 11)
const LINKS = [["/builder", "Build"], ["/compare", "Compare"], ["/skills", "Skills"], ["/docs", "Docs"]] as const;

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-30 flex h-12 items-center gap-6 border-b border-line bg-surface px-4">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-ink">
        <span aria-hidden className="grid h-6 w-6 grid-cols-2 gap-0.5 rounded-md bg-ink p-1">
          <span className="rounded-[2px] bg-[#C2541B]" /><span className="rounded-[2px] bg-[#0E8A61]" />
          <span className="rounded-[2px] bg-[#2563EB]" /><span className="rounded-[2px] bg-white/80" />
        </span>
        LLMVibeCheck
      </Link>
      <div className="flex h-full items-stretch gap-1 text-[13px]">
        {LINKS.map(([href, label]) => {
          const on = path?.startsWith(href);
          return <Link key={href} href={href} aria-current={on ? "page" : undefined}
            className={`flex items-center border-b-2 px-2 ${on ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</Link>;
        })}
      </div>
      <span className="ml-auto hidden text-[12px] text-faint md:block">Find the AI team that does your job best</span>
    </nav>
  );
}


