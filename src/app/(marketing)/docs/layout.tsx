import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Database, LifeBuoy, Terminal } from "lucide-react";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Getting started documentation",
  description: "Connect a certified source, verify its warehouse import, and use Monstera data in Google Sheets or Looker Studio.",
  alternates: { canonical: `${PRODUCT_SITE_URL}/docs` },
  openGraph: {
    title: "Getting started documentation",
    description: "A verified first-run guide for Monstera Cloud reporting workflows.",
    url: `${PRODUCT_SITE_URL}/docs`,
  },
};

const SIDEBAR_LINKS = [
  { title: "Start", icon: Terminal, links: [
    { label: "Overview", href: "/docs#introduction" },
    { label: "Connect a source", href: "/docs#connect-source" },
    { label: "Run the first import", href: "/docs#first-import" },
    { label: "Verify the result", href: "/docs#verify-data" },
  ] },
  { title: "Destinations", icon: Database, links: [
    { label: "Google Sheets", href: "/docs#sheets" },
    { label: "Looker Studio", href: "/docs#looker-studio" },
  ] },
  { title: "Recovery", icon: LifeBuoy, links: [
    { label: "Partial or empty sync", href: "/docs#partial-sync" },
    { label: "Expired connection", href: "/docs#expired-connection" },
    { label: "Limits and support", href: "/docs#limits-support" },
  ] },
] as const;

function DocsNavigation() {
  return (
    <nav aria-label="Documentation sections" className="space-y-7">
      {SIDEBAR_LINKS.map((section) => (
        <div key={section.title}>
          <h2 className="mb-3 flex items-center text-[13px] font-semibold text-ink">
            <section.icon className="mr-2 h-3.5 w-3.5 text-ink-mute" strokeWidth={1.5} aria-hidden />
            {section.title}
          </h2>
          <ul className="ml-2 space-y-1 border-l border-line pl-4">
            {section.links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="block py-1 text-[13px] text-ink-mute transition-colors hover:text-ink">{link.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-canvas font-sans text-ink-mute">
      <div className="mx-auto flex max-w-6xl">
        <aside className="no-scrollbar sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-line px-6 py-10 md:block">
          <p className="mb-8 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute">Documentation</p>
          <DocsNavigation />
        </aside>
        <div className="w-full min-w-0 flex-1 px-4 py-10 sm:px-8 md:py-16">
          <details className="mb-10 rounded-lg border border-line bg-panel p-4 md:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink">
              <BookOpen className="h-4 w-4" aria-hidden /> Browse this guide
            </summary>
            <div className="mt-5 border-t border-line pt-5"><DocsNavigation /></div>
          </details>
          <main className="max-w-4xl">{children}</main>
        </div>
      </div>
    </div>
  );
}
