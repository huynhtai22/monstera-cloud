"use client";
import { useEffect, useState } from "react";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
import { agentRequest } from "@/hooks/use-agent-run";
import type { WarehouseEvidence } from "./task-presentation";
import { useWorkspaceStore } from "@/store/workspace";
import Link from "next/link";
import { CompletionCheck } from "./OnboardingMotion";
import styles from "./Onboarding.module.css";

type Task = AgentSnapshot["tasks"][number];
export type TaskAction = "defer" | "reconnect" | "discover" | "reuse" | "change_scope" | "retry_failed";
export type ImportChoice = { selectedAccountIds: string[]; since: string; until: string; expectedVersion: number };
export type DataPreview = { provider: string; coverage: { limitations: string[] }; verified: boolean; rowsCount: number; timezone: string; omissions: string | null; window: { since: string; until: string }; accounts: { id: string; accountId: string; connectionId: string; groups: { currency: string | null; rows: number; spend: number; conversions: number; revenue: number; dataThroughDate: string | null }[] }[]; sampleRows: { date: string; accountId: string; campaignName: string; spend: number; conversions: number; currency: string | null }[] };

export function AgentTaskSetup({ task, workspaceId, canAuthorize, disabled, onAction, onConfirm, onReviewed, explorerPath }: {
  task: Task; workspaceId: string; canAuthorize: boolean; disabled: boolean;
  onAction: (task: Task, action: TaskAction, connectionId?: string | string[]) => void;
  onConfirm: (task: Task, input: ImportChoice) => void;
  onReviewed: (id: string, evidence: WarehouseEvidence) => void;
  explorerPath: string;
}) {
  const [connections, setConnections] = useState<{ id: string; name: string }[] | null>(null);
  const [chosenConnections, setChosenConnections] = useState<string[]>([]);
  const [preview, setPreview] = useState<DataPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(kind: "connections" | "preview") {
    if (loading) return;
    setLoading(true); setError(null);
    try {
      if (kind === "connections") {
        const data = await agentRequest<{ connections: { id: string; name: string }[] }>(`/api/agent/tasks/${task.id}/connections`);
        setConnections(data.connections);
      } else {
        const data = await agentRequest<DataPreview>(`/api/agent/tasks/${task.id}/preview`);
        setPreview(data); onReviewed(task.id, { verified: data.verified, rowsCount: data.rowsCount, scopeRevision: task.scopeRevision });
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (task.state !== "ready") return;
    let live = true;
    setLoading(true); setError(null);
    void agentRequest<DataPreview>(`/api/agent/tasks/${task.id}/preview`).then(data => {
      if (!live) return;
      setPreview(data);
      onReviewed(task.id, { verified: data.verified, rowsCount: data.rowsCount, scopeRevision: task.scopeRevision });
    }).catch(err => { if (live) setError(err instanceof Error ? err.message : "Unable to confirm warehouse data."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [task.id, task.state, task.importJobId, task.scopeRevision, onReviewed]);
  const busy = disabled || loading;
  const providerName = { meta_ads: "Meta Ads", tiktok_business: "TikTok Ads", google_ads: "Google Ads", shopee: "Shopee" }[task.provider];

  return <div className={styles.executionControls}>
    {error && <p role="alert">{error}</p>}
    {(task.state === "waiting_authorization" || (task.state === "needs_attention" && !task.confirmedScope)) && <>
      {canAuthorize ? <a className={styles.connect} href={`/api/auth/connect?provider=${encodeURIComponent(task.provider)}&workspaceId=${encodeURIComponent(workspaceId)}&agentTaskId=${encodeURIComponent(task.id)}`} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>Connect {providerName} ↗</a> : <button className={styles.connect} disabled>Connect {providerName}</button>}
      {!canAuthorize && <p className={styles.small}>{providerName} authorization is not configured in this environment. Ask your workspace administrator to enable it.</p>}
      <p className={styles.small}>{providerName} handles sign-in and permissions. Import starts only after you choose accounts and dates.</p>
      {task.provider === "shopee" && <p className={styles.small}>Import daily orders and order totals. Ads coverage depends on your Shopee permissions and is optional.</p>}
      <button className={styles.textButton} disabled={busy} onClick={() => void load("connections")}>Use a connected source</button>
      {connections && <div className={styles.connectionChoices}>{connections.length ? task.provider === "google_ads" ? <><fieldset disabled={busy}><legend>Choose Google Ads connections</legend>{connections.map(connection => <label key={connection.id}><input type="checkbox" checked={chosenConnections.includes(connection.id)} onChange={event => setChosenConnections(ids => event.target.checked ? [...ids, connection.id] : ids.filter(id => id !== connection.id))} /> {connection.name}</label>)}</fieldset><button disabled={busy || !chosenConnections.length} onClick={() => onAction(task, "reuse", chosenConnections)}>Discover accounts in selected connections →</button></> : connections.map(connection => <button key={connection.id} disabled={busy} onClick={() => onAction(task, "reuse", connection.id)}>{connection.name} →</button>) : <p className={styles.small}>No connected source is available in this workspace.</p>}</div>}
    </>}
    {(task.state === "discovering_accounts" || (task.state === "needs_attention" && !task.confirmedScope && !!task.requestedScope?.connectionId)) && <button className={styles.textButton} disabled={busy} onClick={() => onAction(task, "discover")}>Refresh authorized accounts</button>}
    {task.state === "waiting_selection" && task.requestedScope && <AccountChoice key={task.requestedScope.discoveredAt} task={task} disabled={busy} onConfirm={onConfirm} />}
    {task.confirmedScope && <p className={styles.small}>{task.confirmedScope.selectedAccountIds.length} selected account(s) · {task.confirmedScope.since} — {task.confirmedScope.until}</p>}
    {task.state === "needs_attention" && task.confirmedScope && <p className={styles.small}>{task.reasonCode === "no_data_found" ? "No usable data was found for the confirmed accounts and dates." : task.reasonCode === "partial_import" ? "Some account imports did not finish. Retry includes only the failed accounts." : "Import did not finish. Check this source in Data explorer."} You can save this source for later.</p>}
    {task.state === "needs_attention" && task.confirmedScope && task.result?.retryRemaining !== 0 && ["partial_import", "import_failed"].includes(task.reasonCode ?? "") && <button className={styles.connect} disabled={busy} onClick={() => onAction(task, "retry_failed")}>Retry failed accounts</button>}
    {task.state === "needs_attention" && task.result?.retryRemaining === 0 && <p className={styles.small}>The retry limit was reached. Check source health, then choose accounts and dates again to approve a new import.</p>}
    {task.state === "needs_attention" && task.confirmedScope && <button className={styles.textButton} disabled={busy} onClick={() => onAction(task, "change_scope")}>Choose accounts or dates again</button>}
    {task.confirmedScope && <div className={styles.warehouseReceipt} role="status">
      <span className={styles.receiptIcon}>{preview?.verified && preview.rowsCount > 0 ? <CompletionCheck /> : <span className={styles.notConnected} />}</span>
      <div><strong>{preview?.verified && preview.rowsCount > 0 ? "Data is in your warehouse" : ["queued", "importing", "verifying"].includes(task.state) ? task.state === "queued" ? "Your import is queued" : "Importing into your warehouse" : task.state === "ready" ? loading ? "Confirming warehouse data…" : "Warehouse confirmation needed" : (preview?.rowsCount ?? task.result?.rowsCount) === 0 ? "No data imported for these dates" : "Import needs attention"}</strong>
      <p>{preview ? `${preview.rowsCount.toLocaleString()} ${preview.rowsCount === 1 ? "row" : "rows"} found for your selected accounts and dates.` : ["queued", "importing", "verifying"].includes(task.state) ? "You can keep setting up other sources. We’ll confirm when data arrives." : task.state === "ready" ? "Checking the saved data for your approved scope." : "Account access is connected. Warehouse data has not been confirmed."}</p>
      <Link href={explorerPath} onClick={() => useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId)}>Open Data explorer →</Link>
      {!["queued", "importing", "verifying"].includes(task.state) && !loading && !(preview?.verified && preview.rowsCount > 0) && <button className={styles.textButton} disabled={busy} onClick={() => void load("preview")}>Check warehouse</button>}
      </div>
    </div>}

  </div>;
}

function AccountChoice({ task, disabled, onConfirm }: { task: Task; disabled: boolean; onConfirm: (task: Task, input: ImportChoice) => void }) {
  const offered = task.requestedScope!;
  const [selected, setSelected] = useState<string[]>([]);
  const [since, setSince] = useState(offered.window.since);
  const [until, setUntil] = useState(offered.window.until);
  return <form className={styles.accountChoice} onSubmit={event => { event.preventDefault(); onConfirm(task, { selectedAccountIds: selected, since, until, expectedVersion: task.version }); }}>
    <fieldset disabled={disabled}><legend>Choose authorized {task.provider === "shopee" ? "shops" : "ad accounts"}</legend>{offered.accounts.map(account => <label key={account.id}><input type="checkbox" checked={selected.includes(account.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, account.id] : ids.filter(id => id !== account.id))} /><span>{account.name}<small>{account.accountId ?? account.id}</small></span></label>)}</fieldset>
    <div className={styles.importDates}><label>From<input aria-label="Import from" type="date" required value={since} disabled={disabled} max={until} onChange={event => setSince(event.target.value)} /></label><label>Through<input aria-label="Import through" type="date" required value={until} disabled={disabled} min={since} max={offered.window.until} onChange={event => setUntil(event.target.value)} /></label></div>
    <p className={styles.small}>Choose up to 50 accounts. Default: seven complete provider reporting days. Up to 30 days, subject to your plan. Only checked accounts are imported into the scope shown above. For client setup, they are assigned to the selected client; existing assignments are never moved.</p>
    <button className={styles.connect} type="submit" disabled={disabled || !selected.length || selected.length > 50 || !since || !until || since > until}>Import {selected.length ? `${selected.length} selected account${selected.length === 1 ? "" : "s"}` : "selected accounts"}</button>
  </form>;
}
