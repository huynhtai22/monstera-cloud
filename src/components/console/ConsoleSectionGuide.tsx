"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, ChevronRight } from "lucide-react";
import { directoryFor } from "@/lib/console-navigation";
import { useClientContextNavigation } from "@/components/client-context/useClientContextNavigation";

/** The production shell uses the same section hierarchy as the design preview. */
export function ConsoleSectionGuide() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { hrefFor } = useClientContextNavigation();
  const [open, setOpen] = useState(false);
  const section = directoryFor(pathname ?? "");
  if (!section) return null;
  const entry = section.entries.find(item => {
    const url = new URL(item.href, "https://console.invalid");
    return url.pathname === pathname && [...url.searchParams].every(([key, value]) => search.get(key) === value);
  }) ?? section.entries[0];

  return (
    <div className="border-b border-line bg-canvas px-4 py-2.5 sm:px-6" data-console-section-guide>
      <div className="flex items-center justify-between gap-3">
        <nav aria-label="Section directory" className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ink-mute">
          <span>{section.group}</span>
          <ChevronRight className="h-3 w-3" aria-hidden />
          <Link href={hrefFor(section.path)} className="hover:text-ink">{section.label}</Link>
          <ChevronRight className="h-3 w-3" aria-hidden />
          <span className="text-ink" aria-current="page">{entry.label}</span>
        </nav>
        <button type="button" aria-expanded={open} aria-controls="console-page-guide" onClick={() => setOpen(value => !value)} className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-mute hover:text-ink">
          <BookOpen className="h-3.5 w-3.5" aria-hidden />Page guide
        </button>
      </div>
      {open && <div id="console-page-guide" className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-mute">
        <p>{entry.purpose}</p>
        <Link href={hrefFor(section.next)} className="mt-2 inline-flex items-center gap-1 text-ink">Next step<ChevronRight className="h-3 w-3" aria-hidden /></Link>
      </div>}
    </div>
  );
}
