"use client";
import { useState } from "react";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
import { agentRequest } from "@/hooks/use-agent-run";
import styles from "./Onboarding.module.css";

type Task = AgentSnapshot["tasks"][number];
export type TaskAction = "defer" | "reconnect" | "discover" | "reuse" | "change_scope" | "retry_failed";
export type ImportChoice = { selectedAccountIds: string[]; since: string; until: string; expectedVersion: number };
export type DataPreview = { provider: string; coverage: { limitations: string[] }; verified: boolean; rowsCount: number; timezone: string; omissions: string | null; window: { since: string; until: string }; accounts: { id: string; accountId: string; connectionId: string; groups: { currency: string | null; rows: number; spend: number; conversions: number; revenue: number; dataThroughDate: string | null }[] }[]; sampleRows: { date: string; accountId: string; campaignName: string; spend: number; conversions: number; currency: string | null }[] };

export function AgentTaskSetup({ task, workspaceId, canAuthorize, disabled, onAction, onConfirm, onReviewed }: {
  task: Task; workspaceId: string; canAuthorize: boolean; disabled: boolean;
  onAction: (task: Task, action: TaskAction, connectionId?: string | string[]) => void;
  onConfirm: (task: Task, input: ImportChoice) => void;
  onReviewed: (id: string) => void;
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
        setPreview(data); if (data.verified && data.rowsCount) onReviewed(task.id);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { setLoading(false); }
  }
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
    {task.state === "needs_attention" && task.confirmedScope && <p className={styles.small}>{task.reasonCode === "no_data_found" ? "No usable data was found for the confirmed accounts and dates." : task.reasonCode === "partial_import" ? "Some account imports did not finish. Review the available data below; retrying includes only failed accounts." : "Import did not finish. Check this source in Data explorer."} You can save this source for later.</p>}
    {task.state === "needs_attention" && task.confirmedScope && task.result?.retryRemaining !== 0 && ["partial_import", "import_failed"].includes(task.reasonCode ?? "") && <button className={styles.connect} disabled={busy} onClick={() => onAction(task, "retry_failed")}>Retry failed accounts</button>}
    {task.state === "needs_attention" && task.result?.retryRemaining === 0 && <p className={styles.small}>The retry limit was reached. Check source health, then choose accounts and dates again to approve a new import.</p>}
    {task.state === "needs_attention" && task.confirmedScope && <button className={styles.textButton} disabled={busy} onClick={() => onAction(task, "change_scope")}>Choose accounts or dates again</button>}
    {(task.state === "ready" || (task.state === "needs_attention" && !!task.confirmedScope)) && <button className={styles.connect} disabled={loading} onClick={() => void load("preview")}>Review imported data</button>}
    {preview && <div className={styles.dataPreview}>
      <h4>{preview.verified ? "Your imported data" : "Available data — needs attention"}</h4>
      <p>{preview.rowsCount} warehouse rows · {preview.window.since} — {preview.window.until}</p>
      <p className={styles.small}>{preview.timezone}. Currency is shown per account; unknown values stay unlabeled.</p>
      {preview.accounts.map(account => <div key={account.id} className={styles.accountEvidence}><strong>{preview.provider === "shopee" ? "Shop" : "Account"} {account.accountId ?? account.id}</strong>{account.groups.length ? account.groups.map((group, index) => <p key={index}>{group.rows} rows · {preview.provider === "shopee" ? `Order total ${group.revenue.toFixed(2)}` : `Spend ${group.spend.toFixed(2)}`} {group.currency ?? "(currency unverified)"} · {group.conversions} {preview.provider === "shopee" ? "orders" : "conversions"} · Data through {group.dataThroughDate}</p>) : <p>No rows for this account in the selected window.</p>}</div>)}
      {preview.coverage.limitations.map(note => <p key={note} className={styles.small}>{note}</p>)}
      <p className={styles.small}>This is source coverage, not a reconciled client report.</p>
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
