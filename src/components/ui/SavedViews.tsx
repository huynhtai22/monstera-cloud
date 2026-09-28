"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Bookmark, Check, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore } from "@/store/workspace";

type SavedView = { id: string; name: string; href: string; createdAt: number };
const STORAGE_PREFIX = "monstera:saved-views:v1";

export function SavedViews({ href, className = "" }: { href: string; className?: string }) {
  const { activeWorkspaceId } = useWorkspaceStore();
  const storageKey = `${STORAGE_PREFIX}:${activeWorkspaceId || "none"}`;
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setViews(Array.isArray(parsed) ? parsed.filter((item): item is SavedView => Boolean(item && typeof item.id === "string" && typeof item.name === "string" && typeof item.href === "string" && item.href.startsWith("/"))) : []);
    } catch { setViews([]); }
  }, [storageKey]);

  const path = useMemo(() => href.split(/[?#]/)[0], [href]);
  const routeViews = views.filter((view) => view.href.split(/[?#]/)[0] === path);
  const persist = (next: SavedView[]) => {
    setViews(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { toast.error("Could not save this view in browser storage."); }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const label = name.trim().slice(0, 60);
    if (!label) return;
    persist([{ id: crypto.randomUUID(), name: label, href, createdAt: Date.now() }, ...views].slice(0, 30));
    setName(""); setAdding(false); setOpen(true);
    toast.success("View saved on this browser");
  };
  const share = async (view: SavedView) => {
    try { await navigator.clipboard.writeText(new URL(view.href, window.location.origin).toString()); toast.success("View link copied"); }
    catch { toast.error("Could not copy the view link"); }
  };

  return <div className={`relative ${className}`}>
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => { setAdding(v => !v); setOpen(false); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink" aria-expanded={adding}>
        <Plus className="h-3.5 w-3.5" /> Save view
      </button>
      <button type="button" onClick={() => { setOpen(v => !v); setAdding(false); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink" aria-expanded={open} aria-label={`Saved views, ${routeViews.length}`}>
        <Bookmark className="h-3.5 w-3.5" /> Views {routeViews.length > 0 && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px]">{routeViews.length}</span>}
      </button>
    </div>
    {adding && <form onSubmit={save} className="absolute right-0 top-11 z-40 w-72 rounded-xl border border-line bg-panel p-3 shadow-xl">
      <label className="block text-xs font-medium text-ink" htmlFor="saved-view-name">Name this view</label>
      <input id="saved-view-name" autoFocus maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Client performance this month" className="mt-2 h-9 w-full rounded-lg border border-line bg-canvas px-3 text-xs text-ink placeholder:text-ink-mute" />
      <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">Saved on this browser for the current workspace. Use Share to copy a link with these filters.</p>
      <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)} className="rounded-md px-2.5 py-1.5 text-xs text-ink-mute hover:text-ink">Cancel</button><button type="submit" disabled={!name.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-canvas disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Save</button></div>
    </form>}
    {open && <div className="absolute right-0 top-11 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
      <div className="border-b border-line px-3 py-2.5"><p className="text-xs font-semibold text-ink">Saved views</p><p className="mt-0.5 text-[11px] text-ink-mute">For this page and workspace</p></div>
      {routeViews.length === 0 ? <p className="px-3 py-7 text-center text-xs text-ink-mute">No saved views for this page yet.</p> : <ul className="max-h-72 overflow-y-auto p-1.5">{routeViews.map(view => <li key={view.id} className="flex items-center gap-1 rounded-lg hover:bg-white/[0.04]"><Link href={view.href} onClick={() => setOpen(false)} className="min-w-0 flex-1 truncate px-2.5 py-2 text-xs font-medium text-ink">{view.name}</Link><button type="button" onClick={() => void share(view)} className="rounded-md p-2 text-ink-mute hover:text-ink" aria-label={`Copy link to ${view.name}`} title="Copy share link"><Copy className="h-3.5 w-3.5" /></button><button type="button" onClick={() => persist(views.filter(item => item.id !== view.id))} className="rounded-md p-2 text-ink-mute hover:text-rose-300" aria-label={`Delete ${view.name}`} title="Delete view"><Trash2 className="h-3.5 w-3.5" /></button></li>)}</ul>}
    </div>}
  </div>;
}
