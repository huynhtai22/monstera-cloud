"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { SavedViews } from "@/components/ui/SavedViews";
import { ConsoleSyncLabel } from "@/components/dashboard/ConsoleSyncLabel";
import { READINESS_MESSAGES } from "@/lib/report-readiness";
import { sampleReadiness, readinessScenarios, type ReadinessScenario } from "./readiness-sample";
import { previewHref } from "./navigation";
import s from "./readiness.module.css";

type Receipt = { id: string; clientId: string; since: string; until: string; scenario: string; outcome: "complete" | "partial" | "failed"; state: "queued" | "running" | "completed" | "failed" | "verified"; accounts: string[]; createdAt: string };
const clients: Record<string, string> = { north: "North Supply", forma: "Forma Studio", goodkind: "Goodkind" };
const labels = { READY: "Ready", NOT_READY: "Needs attention", WARNING: "Review needed", UNKNOWN: "Unknown" };

export function ReadinessWorkbench() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const clientId = params.get("clientId") ?? "north";
  const validClient = Boolean(clients[clientId]);
  const since = params.get("since") ?? "2026-09-25";
  const until = params.get("until") ?? "2026-10-01";
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  let days = NaN;
  try { if (validDate(since) && validDate(until)) days = (Date.parse(until) - Date.parse(since)) / 86400000 + 1; } catch { /* invalid inputs show recovery */ }
  const validWindow = days > 0 && days <= 90 && until <= "2026-10-01";
  const scenario = (readinessScenarios.includes(params.get("scenario") as ReadinessScenario) ? params.get("scenario") : "gap") as ReadinessScenario;
  const scopeKey = `${clientId}:${since}:${until}:${scenario}`;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [outcome, setOutcome] = useState<Receipt["outcome"]>("complete");
  const [inspected, setInspected] = useState<string | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const inspectTrigger = useRef<HTMLButtonElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const active = receipt?.clientId === clientId && receipt.since === since && receipt.until === until && receipt.scenario === scenario ? receipt : null;
  const busy = active?.state === "queued" || active?.state === "running";
  useEffect(() => {
    let saved: Receipt | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(`monstera:readiness-preview:v1:${scopeKey}`) ?? "null"); } catch { /* optional browser state */ }
    // An interrupted preview run has no confirmed completion; let the user retry.
    if (saved?.state === "queued" || saved?.state === "running") saved = { ...saved, state: "failed" };
    setReceipt(saved);
    setInspected(null);
    drawer.current?.close();
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [scopeKey]);
  const storeReceipt = (next: Receipt) => {
    setReceipt(next);
    try { sessionStorage.setItem(`monstera:readiness-preview:v1:${scopeKey}`, JSON.stringify(next)); } catch { /* optional browser state */ }
  };
  function change(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    next.set("view", "readiness");
    for (const [key, value] of Object.entries(patch)) next.set(key, value);
    window.dispatchEvent(new Event("monstera:navigation-start"));
    router.push(`${pathname}?${next}`, { scroll: false });
  }
  const evaluation = validWindow && validClient ? sampleReadiness(clientId, { start: since, end: until }, scenario, active?.state === "verified" ? active.outcome === "complete" ? "complete" : "partial" : "none") : null;
  const accounts = evaluation?.providers.flatMap(provider => provider.evidence.accounts.map(account => ({ ...account, provider: provider.provider }))) ?? [];
  const current = accounts.find(account => account.accountId === inspected);
  const inspectedProvider = evaluation?.providers.find(provider => provider.evidence.accounts.some(account => account.accountId === inspected));
  const canRefresh = evaluation && !["disconnected", "unknown", "empty"].includes(scenario) && evaluation.dataStatus !== "READY";
  function run() {
    if (!evaluation || busy || !canRefresh) return;
    const next: Receipt = { id: `preview-${crypto.randomUUID().slice(0, 8)}`, clientId, since, until, scenario, outcome, state: "queued", accounts: accounts.map(account => account.accountId), createdAt: new Date().toISOString() };
    storeReceipt(next);
    timers.current.push(setTimeout(() => storeReceipt({ ...next, state: "running" }), 650));
    timers.current.push(setTimeout(() => storeReceipt({ ...next, state: outcome === "failed" ? "failed" : "completed" }), 1800));
  }
  function verify() {
    if (active?.state !== "completed") return;
    storeReceipt({ ...active, state: "verified" });
  }
  function close() { drawer.current?.close(); inspectTrigger.current?.focus(); }
  const evidenceHref = (area: string) => previewHref(`${area}?clientId=${encodeURIComponent(clientId)}&startDate=${since}&endDate=${until}`);
  return <PageShell section="reports"><div className={s.root}>
    <header data-console-page-header className={s.header}><div><span className={s.eyebrow}>REPORTS / READINESS</span><h1>Is your report ready?</h1><p>Find the missing evidence, recover the affected window, and verify the result.</p></div><SavedViews href={`${pathname}?${params}`}/></header>
    <div className={s.scope} aria-label="Report scope"><label>Client<select aria-label="Readiness client" value={clientId} onChange={event => change({ clientId: event.target.value })}><option value="all">Choose a client</option>{Object.entries(clients).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>From<input aria-label="Readiness start date" type="date" value={since} onChange={event => change({ since: event.target.value })}/></label><label>To<input aria-label="Readiness end date" type="date" value={until} onChange={event => change({ until: event.target.value })}/></label><span>Account dates · ICT</span></div>
    <details className={s.demo}><summary>Preview scenarios</summary><label>Sample evidence<select aria-label="Readiness scenario" value={scenario} onChange={event => change({ scenario: event.target.value })}>{readinessScenarios.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Preview refresh outcome<select aria-label="Preview refresh outcome" value={outcome} disabled={busy} onChange={event => setOutcome(event.target.value as Receipt["outcome"])}><option value="complete">Complete coverage</option><option value="partial">Partial coverage</option><option value="failed">Failed import</option></select></label><p>Sample evidence and local preview jobs. No provider requests are sent.</p></details>
    {!evaluation ? <section className={s.summary} role="alert"><h2>Choose a client and valid date window</h2><p>Select up to 90 days ending on or before 1 October 2026, the latest date in this sample.</p></section> : <>
      <section className={s.summary} data-readiness-state={evaluation.dataStatus} aria-label="Report data readiness"><div><span className={s.eyebrow}>{clients[clientId]} · {days} days · {accounts.length} required accounts</span><h2>{busy ? <ConsoleSyncLabel active size="large" idleLabel="" activeLabel={active?.state === "queued" ? "Refresh queued" : "Importing selected window"} idleIcon={null}/> : labels[evaluation.dataStatus]}</h2><p>{busy ? "The job uses the client, accounts, and dates recorded below." : evaluation.dataBlockers[0] || evaluation.dataWarnings[0] ? READINESS_MESSAGES[(evaluation.dataBlockers[0] ?? evaluation.dataWarnings[0]).code] : "Account coverage and reporting context pass the data checks for this window."}</p></div><div className={s.summaryAction}>{canRefresh && <button className={s.primary} disabled={busy} onClick={run}>{busy ? "Refresh in progress" : active?.state === "failed" ? "Retry preview refresh" : "Refresh selected window"}</button>}<Link href={previewHref(`/reports?view=performance&clientId=${clientId}&dateFrom=${since}&dateTo=${until}`)}>Open performance<ArrowRight size={14}/></Link></div></section>
      <ol className={s.flow} aria-label="Readiness workflow">{["Check scope", "Inspect evidence", "Refresh", "Verify coverage"].map((step, index) => <li key={step} data-current={index === (active?.state === "verified" ? 3 : active ? 2 : inspected ? 1 : 0)}><span>{index + 1}</span>{step}</li>)}</ol>
      <section className={s.accounts}><div className={s.sectionHead}><h2>Account evidence</h2><span>Missing rows are not assumed to be zero activity</span></div>{!accounts.length ? <p>No account evidence is available. <Link href={previewHref(`/sources?tab=available&clientId=${clientId}`)}>Connect a source</Link></p> : accounts.map(account => <article key={account.accountId}><div><strong>{account.accountId}</strong><small>{account.provider.replaceAll("_", " ")} · {account.presentDays}/{days} days present</small></div><span className={s.accountState}>{account.missingDates.length ? `${account.missingDates.length} dates missing` : "Coverage present"}</span><button onClick={event => { inspectTrigger.current = event.currentTarget; setInspected(account.accountId); drawer.current?.showModal(); }}>Inspect evidence<ArrowRight size={14}/></button></article>)}</section>
      {active && <section className={s.receipt} aria-label="Preview job receipt" role="status"><div className={s.sectionHead}><h2>Preview job receipt</h2><span>{active.id}</span></div><p><strong>{active.state === "verified" ? active.outcome === "complete" ? "Coverage verified" : "Verification found remaining gaps" : active.state === "completed" ? "Import completed · verification required" : active.state === "failed" ? "Import failed · readiness unchanged" : active.state === "queued" ? "Queued" : "Running"}</strong></p><p>{clients[active.clientId]} · {active.since} → {active.until} · {active.accounts.join(", ")}</p>{active.state === "completed" && <button className={s.primary} onClick={verify}>Verify coverage</button>}{active.state === "verified" && <span className={s.verified}><Check size={14}/>Checked against the selected account window</span>}</section>}
      <div className={s.delivery}><strong>Delivery: unverified</strong><span>Data readiness and successful delivery are separate checks.</span><Link href={previewHref(`/exports?clientId=${clientId}`)}>Review destination evidence<ArrowRight size={14}/></Link></div>
    </>}
    <dialog ref={drawer} className={s.drawer} aria-label="Account evidence" onCancel={event => { event.preventDefault(); close(); }}><header><h2>{current?.accountId ?? "Account evidence"}</h2><button aria-label="Close account evidence" onClick={close}><X size={18}/></button></header><p>{clients[clientId]} · {since} → {until}</p>{current && <><h3>{current.presentDays}/{days} days present</h3><p>{current.missingDates.length ? `Missing dates: ${current.missingDates.join(", ")}` : "Daily coverage is present. Check source access, freshness, and reporting context as well."}</p><dl><dt>Evidence source</dt><dd>Sample daily warehouse rows</dd><dt>Latest recorded import</dt><dd>{inspectedProvider?.latestSuccessfulSyncAt ?? "Unknown"}</dd><dt>Currencies</dt><dd>{inspectedProvider?.currencies.join(", ") || "Unknown"}</dd><dt>Timezone evidence</dt><dd>{inspectedProvider?.timezone || "Unknown"}</dd></dl><Link href={evidenceHref("/explorer")}>Inspect warehouse rows<ArrowRight size={14}/></Link><Link href={previewHref(`/sources?tab=connected&clientId=${clientId}`)}>Review source access<ArrowRight size={14}/></Link>{canRefresh && <button className={s.primary} disabled={busy} onClick={() => { close(); run(); }}>Refresh selected window</button>}</>}</dialog>
  </div></PageShell>;
}
