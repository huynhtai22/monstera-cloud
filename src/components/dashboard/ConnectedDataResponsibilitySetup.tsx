"use client";

import { useState } from "react";
import Link from "next/link";
import type { DashboardSourceItem } from "@/lib/dashboard-overview";
import styles from "./ConnectedDataResponsibilitySetup.module.css";

type Account = { id: string; name: string; selected?: boolean };
type AccountState = { loading: boolean; error: string | null; items: Account[] };

type Props = {
  workspaceId: string;
  sources: DashboardSourceItem[];
  monitoringAvailable: boolean;
  onActivated: () => void | Promise<unknown>;
};

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || "Could not save this responsibility");
  return body;
}

async function canonicalScopeHash(items: Array<{ provider: string; connectionId: string; providerAccountId: string }>) {
  const normalized = items.map(item => `${item.provider.trim()}:${item.connectionId.trim()}:${item.providerAccountId.trim()}`).sort();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalized)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function ConnectedDataResponsibilitySetup({ workspaceId, sources, monitoringAvailable, onActivated }: Props) {
  const [accounts, setAccounts] = useState<Record<string, AccountState>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const loadAccounts = async (source: DashboardSourceItem) => {
    setAccounts(previous => ({ ...previous, [source.id]: { loading: true, error: null, items: previous[source.id]?.items ?? [] } }));
    try {
      const body = await responseJson(await fetch(`/api/connections/${encodeURIComponent(source.id)}/accounts`));
      const items = Array.isArray(body.accounts) ? body.accounts as Account[] : [];
      setAccounts(previous => ({ ...previous, [source.id]: { loading: false, error: null, items } }));
    } catch (loadError) {
      setAccounts(previous => ({ ...previous, [source.id]: { loading: false, error: loadError instanceof Error ? loadError.message : String(loadError), items: [] } }));
    }
  };

  const toggleAccount = (connectionId: string, accountId: string, checked: boolean) => {
    setSelected(previous => ({ ...previous, [`${connectionId}:${accountId}`]: checked }));
  };

  const scopeItems = sources.flatMap(source => (accounts[source.id]?.items ?? [])
    .filter(account => selected[`${source.id}:${account.id}`])
    .map(account => ({ connectionId: source.id, provider: source.provider, providerAccountId: account.id, accountName: account.name })));

  const activate = async () => {
    if (!consented || scopeItems.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const draft = await responseJson(await fetch("/api/agent-console/responsibilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          kind: "data_health",
          configuration: { recoveryPolicy: "retry_failed_window", permittedRecoveryModes: ["retry_failed_window"] },
          cadence: "daily",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          scopeItems,
        }),
      }));
      const responsibility = draft.responsibility;
      const allowedPairs = scopeItems.map(({ connectionId, provider, providerAccountId }) => ({ connectionId, provider, providerAccountId }));
      await responseJson(await fetch(`/api/agent-console/responsibilities/${encodeURIComponent(responsibility.id)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          expectedVersion: responsibility.version,
          scopeHash: await canonicalScopeHash(scopeItems),
          allowlistedTools: ["submit_recovery_import"],
          allowedPairs,
          limits: { permittedRecoveryModes: ["retry_failed_window"] },
        }),
      }));
      setDone(true);
      await onActivated();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  if (done) return null;

  if (!monitoringAvailable) {
    return (
      <section className={styles.card} aria-labelledby="data-health-setup-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>MONITORING STATUS</p>
          <h2 id="data-health-setup-title">Connected data checks are unavailable</h2>
          <p>Daily checks are not available in this workspace yet. You can still connect sources and import data; no monitoring responsibility will be activated.</p>
        </div>
      </section>
    );
  }

  const selectableSources = sources.filter(source =>
    source.state !== "disconnected" && ["meta_ads", "google_ads", "tiktok_business"].includes(source.provider)
  );
  return (
    <section className={styles.card} aria-labelledby="data-health-setup-title">
      <div className={styles.intro}>
        <p className={styles.eyebrow}>ONGOING RESPONSIBILITY</p>
        <h2 id="data-health-setup-title">Keep my connected data healthy</h2>
        <p>Choose the sources and accounts Monstera should check. Nothing starts until you review and approve this responsibility.</p>
      </div>

      <div className={styles.sources}>
        {selectableSources.map(source => {
          const state = accounts[source.id] ?? { loading: false, error: null, items: [] };
          return (
            <fieldset key={source.id} className={styles.source}>
              <legend>{source.name}</legend>
              {!state.items.length && (
                <button type="button" className={styles.secondary} onClick={() => void loadAccounts(source)} disabled={state.loading}>
                  {state.loading ? "Loading accounts…" : "Choose accounts"}
                </button>
              )}
              {state.error && <p className={styles.error} role="alert">{state.error}</p>}
              {state.items.map(account => {
                const key = `${source.id}:${account.id}`;
                return (
                  <label className={styles.account} key={key}>
                    <input type="checkbox" checked={Boolean(selected[key])} onChange={event => toggleAccount(source.id, account.id, event.target.checked)} />
                    <span>{account.name}</span>
                    <small>{account.id}</small>
                  </label>
                );
              })}
              {!state.loading && !state.error && state.items.length === 0 && accounts[source.id] && <p className={styles.muted}>No saved accounts are available for this source yet.</p>}
            </fieldset>
          );
        })}
        {selectableSources.length === 0 && (
          <p className={styles.muted}>
            {sources.length
              ? "Account-level checks currently support Meta Ads, Google Ads, and TikTok Ads sources."
              : <>Connect a supported source before setting up monitoring. <Link href="/sources">Connect a source →</Link></>}
          </p>
        )}
      </div>

      <div className={styles.policy}>
        <p><strong>Check schedule</strong><span>Daily</span></p>
        <p><strong>Permitted recovery</strong><span>Retry failed imports for the accounts you select</span></p>
        <p><strong>If access expires</strong><span>Ask you to reconnect; Monstera will not change campaigns or deliver reports</span></p>
      </div>

      <label className={styles.consent}>
        <input type="checkbox" checked={consented} onChange={event => setConsented(event.target.checked)} />
        <span>I approve daily checks and retries of failed imports for the selected accounts under the policy above.</span>
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button type="button" className={styles.primary} disabled={!consented || scopeItems.length === 0 || busy} onClick={() => void activate()}>
        {busy ? "Saving your approval…" : "Approve and start daily checks"}
      </button>
    </section>
  );
}
