"use client";

import { Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SessionContext } from "next-auth/react";
import { SWRConfig, useSWRConfig } from "swr";
import { ArrowRight, BookOpen, ChevronRight, Compass, Search, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { ConsoleSyncLabel } from "@/components/dashboard/ConsoleSyncLabel";
import { ConsoleOverview } from "@/components/dashboard/ConsoleOverview";
import type { AgentConsoleOperationalSummary } from "@/lib/agent-console/console-summary";
import { PageShell } from "@/components/ui/PageShell";
import { useWorkspaceStore } from "@/store/workspace";
import { productionOverview, sampleApiPayload, sampleSession, SAMPLE_WORKSPACE_ID } from "./preview-data";
import { consoleDirectory, directoryFor, previewHref, PREVIEW_ROOT } from "./navigation";
import { previewStates, type PreviewState } from "../console/fixtures";
import s from "./structure.module.css";
import { DataJourney } from "./DataJourney";
import { ReadinessWorkbench } from "./ReadinessWorkbench";

const loading = () => <div data-console-page-loading role="status" className="flex min-h-48 items-center justify-center gap-3 p-10 text-sm text-ink-mute"><ConsoleSyncLabel active size="large" idleLabel="" activeLabel="Loading page" idleIcon={null} /></div>;
const Sources = dynamic(() => import("@/components/sources/SourcesPageContent").then(module => module.SourcesPageContent), { loading });
const SourceDetail = dynamic(() => import("@/components/sources/SourceDetailContent").then(module => module.SourceDetailContent), { loading });
const SourceSetup = dynamic(() => import("@/components/sources/SourceSetupContent").then(module => module.SourceSetupContent), { loading });
const Operations = dynamic(() => import("@/app/(app)/operations/OperationsClient").then(module => module.OperationsClient), { loading });
const Reports = dynamic(() => import("@/app/(app)/reports/ReportsClient").then(module => module.ReportsClient), { loading });
const Explorer = dynamic(() => import("@/components/data-explorer/WarehouseWorkbench").then(module => module.WarehouseWorkbench), { loading });
const Exports = dynamic(() => import("@/app/(app)/exports/page"), { loading });
const Clients = dynamic(() => import("@/app/(app)/clients/ClientsClient").then(module => module.ClientsClient), { loading });
const SettingsPage = dynamic(() => import("@/app/(app)/settings/page"), { loading });
const cache = () => new Map();

export function ConsoleStructurePreview() {
  const pathname = usePathname();
  const productionPath = pathname?.slice(PREVIEW_ROOT.length) || "/console";
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<PreviewState>("Overview");
  const [notice, setNotice] = useState("");
  const stateRef = useRef(state);
  const originalWorkspace = useRef<string | null>(null);
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    originalWorkspace.current = useWorkspaceStore.getState().activeWorkspaceId;
    const fixtureFetch: typeof window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
      if (!url.pathname.startsWith("/api/") && url.origin === window.location.origin) return originalFetch(input, init);
      const debug = window as typeof window & { __previewBlockedReads?: string[] };
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        setNotice("Preview only. This action wasn’t sent. Your live data is unchanged.");
        return Response.json({ error: "This is a read-only production UI preview. No live action was sent.", code: "PREVIEW_READ_ONLY" }, { status: 409 });
      }
      const payload = sampleApiPayload(url, stateRef.current);
      if (payload === null) { (debug.__previewBlockedReads ??= []).push(url.pathname); return Response.json({ error: `No sample fixture for ${url.pathname}. Live requests are blocked.`, code: "PREVIEW_UNAVAILABLE" }, { status: 503 }); }
      return Response.json(payload);
    };
    window.fetch = fixtureFetch;
    useWorkspaceStore.getState().setActiveWorkspaceId(SAMPLE_WORKSPACE_ID);
    setReady(true);
    return () => {
      if (window.fetch === fixtureFetch) window.fetch = originalFetch;
      if (useWorkspaceStore.getState().activeWorkspaceId === SAMPLE_WORKSPACE_ID)
        useWorkspaceStore.getState().setActiveWorkspaceId(originalWorkspace.current);
    };
  }, []);
  if (!ready) return <div className="min-h-screen bg-canvas p-10 text-sm text-ink-mute">Preparing the production console preview…</div>;
  return <SessionContext.Provider value={{ data: sampleSession, status: "authenticated", update: async () => sampleSession }}><SWRConfig value={{ provider: cache, revalidateOnFocus: false, revalidateOnReconnect: false, refreshInterval: 0, errorRetryCount: 0 }}><Suspense fallback={loading()}><ProductionScreen productionPath={productionPath} state={state} notice={notice} onNotice={setNotice} onState={next => { stateRef.current = next; setState(next); }}/></Suspense></SWRConfig></SessionContext.Provider>;
}

function ProductionScreen({ productionPath, state, onState, notice, onNotice }: { productionPath: string; state: PreviewState; onState: (state: PreviewState) => void; notice: string; onNotice: (notice: string) => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const { mutate } = useSWRConfig();
  const [guide, setGuide] = useState(false);
  const [query, setQuery] = useState("");
  const [areaViews, setAreaViews] = useState<Record<string, string>>({});
  const observedQuery = params.toString();
  useEffect(() => {
    // Remember each area's URL independently; explicit deep links remain authoritative.
    const area = directoryFor(productionPath);
    if (!area || productionPath !== area.path) return;
    let previous: Record<string, string> = {};
    try { previous = JSON.parse(sessionStorage.getItem("monstera:preview:area-views") ?? "{}"); } catch { /* storage is optional */ }
    const next = { ...previous, [area.path]: observedQuery };
    setAreaViews(next);
    try { sessionStorage.setItem("monstera:preview:area-views", JSON.stringify(next)); } catch { /* storage is optional */ }
  }, [productionPath, observedQuery]);
  const [dismissed, setDismissed] = useState(true);
  const section = directoryFor(productionPath);
  const directory = productionPath === "/directory";
  const sourceId = productionPath.startsWith("/sources/") ? productionPath.split("/")[2] : null;
  const currentEntry = section?.entries.find(entry => {
    const expected = new URL(entry.href, "https://preview.invalid").searchParams;
    return [...expected.entries()].every(([key, value]) => params.get(key) === value);
  }) ?? section?.entries[0];
  const title = directory ? "Console directory" : sourceId === "setup" ? "Source setup" : sourceId ? "Source details" : section?.label ?? "Setup guidance";
  const clientId = params.get("clientId");
  const scope = clientId && clientId !== "all" ? ({ north: "North Supply", forma: "Forma Studio", goodkind: "Goodkind" }[clientId] ?? clientId) : "All clients";
  const overview = productionOverview(state);
  const agentConsoleSummary = sampleApiPayload(new URL("http://localhost/api/agent-console/summary"), state) as AgentConsoleOperationalSummary;
  const guideTrigger = useRef<HTMLButtonElement>(null);
  const boundaryDialog = useRef<HTMLDialogElement>(null);
  const [boundary, setBoundary] = useState<string | null>(null);
  useEffect(() => { if (boundary) boundaryDialog.current?.showModal(); }, [boundary]);

  function routeHref(href: string) {
    const localHref = href.startsWith(PREVIEW_ROOT) ? href.slice(PREVIEW_ROOT.length) : href;
    const url = new URL(localHref, window.location.origin);
    const area = directoryFor(url.pathname);
    const filterKeys: Record<string, string[]> = {
      "/sources": ["tab", "search"], "/reports": ["view", "source", "status", "dateFrom", "dateTo", "since", "until", "scenario"],
      "/explorer": ["startDate", "endDate", "platform", "mode", "dimensions", "metrics"],
      "/clients": ["mode", "status", "search"], "/settings": ["tab"], "/operations": [], "/exports": [], "/console": [],
    };
    if (area && area.path !== section?.path && url.pathname === area.path) {
      const allowed = new Set(["clientId", ...(filterKeys[area.path] ?? [])]);
      [...url.searchParams.keys()].forEach(key => { if (!allowed.has(key)) url.searchParams.delete(key); });
    }
    if (area && url.pathname === area.path && [...url.searchParams.keys()].every(key => key === "clientId")) {
      const remembered = new URLSearchParams(areaViews[area.path] ?? "");
      remembered.delete("clientId");
      remembered.forEach((value, key) => url.searchParams.set(key, value));
    }
    if (clientId && !url.searchParams.has("clientId") && url.pathname !== "/console") url.searchParams.set("clientId", clientId);
    return previewHref(`${url.pathname}${url.search}${url.hash}`);
  }
  function follow(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
    if (!anchor) {
      const button = (event.target as HTMLElement).closest("button");
      if (button && button.matches('[role="tab"][aria-selected="false"], [data-console-view-switch][aria-pressed="false"]')) window.dispatchEvent(new Event("monstera:navigation-start"));
      if (button?.textContent?.trim() === "Sign out") { event.preventDefault(); event.stopPropagation(); setBoundary("Sign-out belongs to your real account. This preview keeps the sample session active."); }
      return;
    }
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("blob:")) return;
    event.preventDefault(); event.stopPropagation();
    if (href.startsWith(PREVIEW_ROOT) || directoryFor(href.split("?")[0].split("#")[0]) || href.startsWith("/directory")) { const target = new URL(routeHref(href), window.location.origin); if (`${target.pathname}${target.search}` !== `${window.location.pathname}${window.location.search}`) window.dispatchEvent(new Event("monstera:navigation-start")); router.push(routeHref(href)); }
    else setBoundary(`This destination is available in the live console. You can keep exploring here without changing your account.`);
  }
  async function changeState(next: PreviewState) { onState(next); await mutate(() => true, undefined, { revalidate: true }); }
  function closeGuide() { setGuide(false); guideTrigger.current?.focus(); }
  const nextSection = section ? directoryFor(section.next.split("?")[0]) : undefined;
  const workflowAction = ({ "/sources": "Inspect imported data", "/explorer": "Review reports", "/reports": "Set up an export", "/exports": "Manage API access" } as Record<string, string>)[productionPath];
  const groups = ["All areas", "Overview", "Pipelines", "Data", "Management"];
  const selectedGroup = groups.includes(params.get("group") ?? "") ? params.get("group")! : "All areas";
  const visibleSections = consoleDirectory.filter(item => (selectedGroup === "All areas" || item.group === selectedGroup) && `${item.label} ${item.purpose} ${item.entries.map(entry => `${entry.label} ${entry.purpose}`).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  function changeGroup(group: string) {
    const next = new URLSearchParams(params.toString());
    if (group === "All areas") next.delete("group"); else next.set("group", group);
    router.push(`${previewHref(productionPath)}${next.size ? `?${next}` : ""}`, { scroll: false });
  }
  function changeClient(value: string) {
    const next = new URLSearchParams(params.toString());
    if (productionPath === "/sources" && !next.has("tab")) next.set("tab", "connected");
    if (value === "all") next.delete("clientId"); else next.set("clientId", value);
    router.push(`${previewHref(productionPath)}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  let content;
  if (directory) content = <PageShell>
    <div className={s.directoryHead}><span>WORKSPACE / DIRECTORY</span><h1>Find the right place to work.</h1><p>Choose an area, or search for the task you need.</p></div>
    <div className={s.directoryToolbar}>
      <div className={s.directoryFilters} role="group" aria-label="Filter console directory">{groups.map(group => <button key={group} type="button" aria-pressed={selectedGroup === group} onClick={() => changeGroup(group)}>{group}</button>)}</div>
      <label className={s.directorySearch}><Search size={16}/><input aria-label="Search console directory" placeholder="Search pages and tasks…" value={query} onChange={event => setQuery(event.target.value)}/></label>
    </div>
    <div className={s.directoryCount} role="status">{visibleSections.length} {visibleSections.length === 1 ? "area" : "areas"}<span>Direct links to your workspace tools</span></div>
    <div className={s.directoryGrid}>{visibleSections.map(item => <section className={s.directoryCard} key={item.path}>
      <div className={s.directoryCardHead}><item.icon size={18}/><h2><Link href={routeHref(item.path)}>{item.label}<ArrowRight size={14}/></Link></h2><span>{item.group}</span></div>
      <p>{item.purpose}</p>
      <ul>{item.entries.map(entry => <li key={entry.href}><Link href={routeHref(entry.href)} title={entry.purpose}><span><strong>{entry.label}</strong></span><ChevronRight size={13}/></Link></li>)}</ul>
    </section>)}</div>
    {!visibleSections.length && <div className={s.emptyDirectory}><Search size={22}/><h2>No matching pages</h2><p>Try another task, or clear your search and area filter.</p><button type="button" onClick={() => { setQuery(""); changeGroup("All areas"); }}>Clear filters</button></div>}
  </PageShell>;
  else if (sourceId === "setup") content = <SourceSetup hrefTransform={routeHref}/>;
  else if (sourceId) content = <SourceDetail connectionIdOverride={sourceId}/>;
  else if (productionPath === "/console") content = <ConsoleOverview overview={overview} isUpdating={false} onRefresh={() => { void mutate(() => true, undefined, { revalidate: true }); onNotice("Sample view refreshed."); }} wizardDismissed={dismissed} onWizardDismiss={() => setDismissed(true)} onWizardResume={() => setDismissed(false)} onReconnect={() => setBoundary("Reconnect opens your provider’s authorization page in the live console. This preview won’t change access.")} agentConsoleSummary={agentConsoleSummary} onRefreshSummary={async () => { await mutate(() => true, undefined, { revalidate: true }); }} />;
  else if (productionPath === "/sources") content = <Sources previewBasePath={previewHref("/sources")} previewMode/>;
  else if (productionPath === "/operations") content = <Operations/>;
  else if (productionPath === "/reports") content = params.get("view") === "readiness" ? <ReadinessWorkbench/> : <Reports/>;
  else if (productionPath === "/explorer") content = <PageShell section="warehouse"><Explorer/></PageShell>;
  else if (productionPath === "/exports") content = <Exports/>;
  else if (productionPath === "/clients") content = <Clients/>;
  else if (productionPath === "/settings") content = <SettingsPage/>;
  else content = <PageShell><h1>Page unavailable in this preview</h1><Link href={routeHref("/directory")}>Browse console directory</Link></PageShell>;

  return <div className={s.root} onClickCapture={follow}><AppLayout visualPreview previewTitle={title} previewPath={section?.path ?? productionPath} previewHref={routeHref} previewDirectories={Object.fromEntries(consoleDirectory.map(area => [area.path, area.entries.map(entry => ({ label: entry.label, href: routeHref(entry.href) }))]))}>
    <div className={s.previewBar}><div><span className={s.previewDot}/><strong>Production console preview</strong><span>Sample data · live actions disabled</span></div><label>Sample state<select aria-label="Preview state" value={state} onChange={event => void changeState(event.target.value as PreviewState)}>{previewStates.map(option => <option key={option}>{option}</option>)}</select></label></div>
    <div className={s.locationBar}><nav aria-label="Page directory"><Link href={routeHref("/directory")}><Compass size={15}/>Console directory</Link>{section && <><ChevronRight size={13}/><span>{section.group}</span><ChevronRight size={13}/><Link href={routeHref(section.path)}>{section.label}</Link></>}{!directory && currentEntry && <><ChevronRight size={13}/><span>{sourceId ? sourceId : currentEntry.label}</span></>}</nav><div className={s.locationActions}><span className={s.loadingSlot} data-console-loading-slot/><DataJourney overview={overview} href={routeHref} locationKey={`${productionPath}?${params}`}/>{productionPath === "/console" && <Link className={s.workflowLink} href={routeHref("/reports?view=readiness&clientId=north")}>Check report readiness<ArrowRight size={14}/></Link>}{workflowAction && section && <Link className={s.workflowLink} href={routeHref(section.next)}>{workflowAction}<ArrowRight size={14}/></Link>}<label className={s.clientScope}><span>Client</span><select aria-label="Console client scope" value={clientId ?? "all"} onChange={event => changeClient(event.target.value)}><option value="all">All clients</option><option value="north">North Supply</option><option value="forma">Forma Studio</option><option value="goodkind">Goodkind</option></select></label><button ref={guideTrigger} type="button" className={s.guideButton} aria-expanded={guide} onClick={() => setGuide(value => !value)}><BookOpen size={15}/>{guide ? "Hide page guide" : "Page guide"}</button></div></div>
    <span className="sr-only">Viewing: {scope}</span>
    {notice && <div className={s.notice} role="status">{notice}<button aria-label="Dismiss preview message" onClick={() => onNotice("")}><X size={15}/></button></div>}
    <div className={`${s.content} ${guide ? s.withGuide : ""}`}><div data-console-transition-content className={s.productionContent}>{content}</div>{guide && <aside className={s.guide} aria-label="Page guidance"><div className={s.guideHead}><span>PAGE GUIDE</span><button aria-label="Close page guide" onClick={closeGuide}><X size={18}/></button></div><h2>{title}</h2><p>{section?.purpose ?? "Find the right console screen for your task."}</p><dl><dt>Your location</dt><dd>{section?.group ?? "Console"} / {section?.label ?? "Directory"}{sourceId ? ` / ${sourceId}` : ""}</dd><dt>Client scope</dt><dd>{scope}</dd><dt>Use this page to</dt><dd>{currentEntry?.purpose ?? "Find the right console screen for your task."}</dd></dl>{section && <><h3>In this directory</h3><ul>{section.entries.map(entry => <li key={entry.href}><Link href={routeHref(entry.href)}><strong>{entry.label}</strong><small>{entry.purpose}</small></Link></li>)}</ul><div className={s.nextStep}><span>NEXT IN YOUR WORKFLOW</span><Link href={routeHref(section.next)}>{nextSection?.label ?? "Dashboard"}<ArrowRight size={16}/></Link><p>{nextSection?.purpose}</p></div></>}<Link className={s.fullDirectory} href={routeHref("/directory")}><Compass size={16}/>Browse console directory</Link></aside>}</div>
    <dialog ref={boundaryDialog} className={s.boundary} aria-label="Preview action boundary" onClose={() => setBoundary(null)}><h2>Available in the live console</h2><p>{boundary}</p><button onClick={() => boundaryDialog.current?.close()}>Back to console preview</button></dialog>
  </AppLayout></div>;
}
