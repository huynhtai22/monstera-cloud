"use client";
import Link from "next/link";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
import type { DataPreview } from "./AgentTaskSetup";
import { ONBOARDING_PROVIDERS } from "@/lib/agent/catalog";
import { useWorkspaceStore } from "@/store/workspace";
import type { onboardingGoal } from "@/lib/agent/onboarding-goals";
import { confirmedFirstResultTasks, firstResultAccounts } from "./first-result";
import styles from "./Onboarding.module.css";

export function FirstResult({ tasks, previews, goal, explorerPath, workspaceId, reportsPath, clientId, acknowledged, onAcknowledge }: {
  tasks: AgentSnapshot["tasks"]; previews: Record<string, { scopeRevision: number; data: DataPreview }>;
  goal: ReturnType<typeof onboardingGoal>; explorerPath: string; workspaceId: string; reportsPath: string; clientId: string | null; acknowledged: boolean; onAcknowledge: () => void;
}) {
  const ready = tasks.filter(task => task.state === "ready");
  const confirmed = confirmedFirstResultTasks(tasks, previews);
  return <section className={styles.firstResult} aria-labelledby="first-result-title">
    <p className={styles.eyebrow}>YOUR FIRST OVERVIEW</p><h2 id="first-result-title">{goal?.context ?? "Your connected campaign data"}</h2>
    <p className={styles.small}>A snapshot of the data available for your approved accounts and dates. Provider results are shown separately; this is not a reconciled cross-platform report.</p>
    {confirmed.map(task => { const data = previews[task.id].data; const accounts = firstResultAccounts(data); const populatedCount = data.accounts.filter(account => account.groups.some(group => group.rows > 0)).length; return <article key={task.id}>
      <h3>{ONBOARDING_PROVIDERS.find(provider => provider.id === task.provider)?.name}</h3>
      <p>{data.window.since} — {data.window.until} · {data.accounts.length} accounts · {data.rowsCount.toLocaleString()} warehouse rows</p>
      {accounts.map(account => <div key={account.id}><strong>{task.requestedScope?.accounts.find(offered => (offered.accountId ?? offered.id) === account.accountId)?.name ?? account.accountId}</strong>{account.groups.map((group, index) => <p key={index}>{group.currency ? `${group.currency} ${(task.provider === "shopee" ? group.revenue : group.spend).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${task.provider === "shopee" ? "order revenue" : "spend"}` : "Currency unverified; spend total withheld"} · {group.rows.toLocaleString()} {group.rows === 1 ? "row" : "rows"}{group.dataThroughDate ? ` · data through ${group.dataThroughDate.slice(0, 10)}` : ""}</p>)}</div>)}
      {populatedCount > accounts.length && <p className={styles.small}>{populatedCount - accounts.length} more populated accounts available in Data explorer.</p>}
      {data.accounts.length > populatedCount && <p className={styles.small}>{data.accounts.length - populatedCount} approved accounts have no warehouse rows in this window. Check coverage before reporting.</p>}
      <div className={styles.outputRows} tabIndex={0} role="region" aria-label="Imported rows">
        <table><caption>Imported rows · sample of up to 10</caption><thead><tr><th>Date</th><th>Account</th><th>Campaign / order reference</th><th>{task.provider === "shopee" ? "Order revenue" : "Spend"}</th></tr></thead>
          <tbody>{data.sampleRows.map((row, index) => <tr key={index}><td>{row.date.slice(0, 10)}</td><td>{row.accountId}</td><td>{row.campaignName || "—"}</td><td>{row.currency ? `${row.currency} ${(task.provider === "shopee" ? row.revenue : row.spend).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "Currency unverified; amount withheld"}</td></tr>)}</tbody>
        </table>
      </div>
      <p className={styles.small}>{data.timezone}</p>
      {data.coverage.limitations.filter(limitation => limitation !== data.timezone).map(limitation => <p className={styles.small} key={limitation}>{limitation}</p>)}
    </article>; })}
    {confirmed.length !== ready.length && <p role="status">Confirming the remaining source data. Open its agent to check the warehouse if confirmation needs attention.</p>}
    {confirmed.length > 0 && <p className={styles.small}>Consent and approved import complete. Review the warehouse rows above before continuing. Provider totals and destination delivery still need a separate check.</p>}
    {goal?.id === "reporting" && <Link href={`${reportsPath}?${new URLSearchParams({ view: "readiness", ...(clientId ? { clientId } : {}), ...(confirmed[0]?.confirmedScope ? { since: confirmed[0].confirmedScope.since, until: confirmed[0].confirmedScope.until } : {}) })}`} onClick={() => useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId)}>Check client report readiness →</Link>}
    <p className={styles.small}>Suggested next question: “{goal?.prompt ?? "What data is available for my campaigns?"}”</p>
    <Link href={explorerPath} onClick={() => useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId)}>Explore the underlying data →</Link>
    <button className={styles.primary} disabled={confirmed.length !== ready.length || acknowledged} onClick={onAcknowledge}>{acknowledged ? "Overview reviewed" : "I’ve reviewed this overview"}</button>
  </section>;
}
