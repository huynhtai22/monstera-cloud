"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, X } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";

type Item = { id: string; label: string; detail: string; href: string; group: string };
const BASE: Item[] = [
  { id: "dashboard", label: "Dashboard", detail: "Workspace overview", href: "/console", group: "Navigate" },
  { id: "operations", label: "Operations", detail: "Current issues and next actions", href: "/operations", group: "Navigate" },
  { id: "sources", label: "Sources", detail: "Connections and accounts", href: "/sources", group: "Navigate" },
  { id: "reports", label: "Reports", detail: "Client performance and reporting workflow", href: "/reports", group: "Navigate" },
  { id: "warehouse", label: "Data explorer", detail: "Search and filter warehouse data", href: "/explorer", group: "Navigate" },
  { id: "exports", label: "Exports & API", detail: "Destinations and access", href: "/exports", group: "Navigate" },
  { id: "clients", label: "Clients", detail: "Client portfolio and readiness", href: "/clients", group: "Navigate" },
  { id: "settings", label: "Settings", detail: "Workspace settings", href: "/settings", group: "Navigate" },
];

function PaletteSurface() {
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspaceStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>(BASE);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = () => { setOpen(true); setQuery(""); };
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); onOpen(); }
    };
    window.addEventListener("open-monstera-command-palette", onOpen);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("open-monstera-command-palette", onOpen); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => {
    if (!open || !activeWorkspaceId) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ workspaceId: activeWorkspaceId });
    Promise.allSettled([fetch("/api/workspaces", { cache: "no-store" }).then(r => r.ok ? r.json() : []), fetch(`/api/clients?${params}`, { cache: "no-store" }).then(r => r.ok ? r.json() : [])]).then(([workspacesResult, clientsResult]) => {
      if (cancelled) return;
      const workspacePayload = workspacesResult.status === "fulfilled" ? workspacesResult.value : [];
      const workspace = Array.isArray(workspacePayload) ? workspacePayload.find((entry: { id?: string }) => entry.id === activeWorkspaceId) : null;
      const sources = (workspace?.sources ?? []).map((source: { id: string; name: string; provider: string; status: string }) => ({ id: `source-${source.id}`, label: source.name || source.provider, detail: `${source.provider.replaceAll("_", " ")} · ${source.status}`, href: `/sources/${encodeURIComponent(source.id)}#source-recovery`, group: "Sources" } satisfies Item));
      const clientsPayload = clientsResult.status === "fulfilled" ? clientsResult.value : [];
      const clients = (Array.isArray(clientsPayload) ? clientsPayload : clientsPayload?.clients ?? []).map((client: { id: string; name: string }) => ({ id: `client-${client.id}`, label: client.name, detail: "Client reports and readiness", href: `/reports?clientId=${encodeURIComponent(client.id)}&view=performance#report-readiness`, group: "Clients" } satisfies Item));
      setItems([...BASE, ...clients, ...sources]); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, activeWorkspaceId]);

  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? items.filter(item => `${item.label} ${item.detail} ${item.group}`.toLowerCase().includes(q)) : items).slice(0, 12);
  }, [items, query]);
  useEffect(() => setActive(0), [query]);
  const choose = (item: Item) => {
    const url = new URL(item.href, window.location.origin);
    const currentClient = new URLSearchParams(window.location.search).get("clientId");
    if (currentClient && !url.searchParams.has("clientId") && ["/clients", "/sources", "/reports", "/explorer", "/exports", "/operations"].includes(url.pathname)) url.searchParams.set("clientId", currentClient);
    setOpen(false); router.push(`${url.pathname}${url.search}${url.hash}`);
  };

  if (!open) return null;
  return <div className="fixed inset-0 z-[210] flex items-start justify-center bg-black/55 p-3 pt-[12vh] backdrop-blur-sm sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
    <section role="dialog" aria-modal="true" aria-label="Search Monstera" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
      <div className="flex items-center gap-3 border-b border-line px-4"><Search className="h-4 w-4 text-ink-mute" aria-hidden /><input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={event => {
        if (event.key === "Escape") setOpen(false);
        if (event.key === "ArrowDown") { event.preventDefault(); setActive(i => Math.min(i + 1, filtered.length - 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
        if (event.key === "Enter" && filtered[active]) choose(filtered[active]);
      }} placeholder="Search clients, sources, or pages…" aria-label="Search clients, sources, or pages" className="h-14 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-mute" /><kbd className="rounded border border-line px-1.5 py-1 text-[10px] text-ink-mute">ESC</kbd><button type="button" onClick={() => setOpen(false)} className="rounded p-1.5 text-ink-mute hover:text-ink" aria-label="Close search"><X className="h-4 w-4" /></button></div>
      <div className="max-h-[min(60vh,30rem)] overflow-y-auto p-2" role="listbox" aria-label="Search results">{loading && <p className="px-3 py-2 text-xs text-ink-mute">Searching this workspace…</p>}{filtered.length === 0 && !loading ? <p className="px-3 py-8 text-center text-xs text-ink-mute">No matching client, source, or page.</p> : filtered.map((item, index) => <button key={item.id} type="button" role="option" aria-selected={index === active} onMouseEnter={() => setActive(index)} onClick={() => choose(item)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${index === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{item.label}</span><span className="mt-0.5 block truncate text-[11px] text-ink-mute">{item.group} · {item.detail}</span></span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-mute" /></button>)}</div>
      <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[10px] text-ink-mute"><span>Search your current workspace</span><span>↑ ↓ to move · Enter to open</span></div>
    </section>
  </div>;
}

export function CommandPalette() { return <Suspense fallback={null}><PaletteSurface /></Suspense>; }
export function CommandPaletteTrigger() {
  return <button type="button" onClick={() => window.dispatchEvent(new Event("open-monstera-command-palette"))} className="pointer-events-auto hidden min-h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5 text-xs text-ink-mute hover:text-ink sm:flex" aria-label="Search clients, sources, and pages"><Search className="h-3.5 w-3.5" />Search…<kbd className="rounded border border-line px-1 py-0.5 font-mono text-[10px]">⌘K</kbd></button>;
}
