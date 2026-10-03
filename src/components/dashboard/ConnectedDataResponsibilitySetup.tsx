"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { DashboardSourceItem } from "@/lib/dashboard-overview";
import type { DataHealthSetupDraft } from "@/lib/agent-console/setup-contracts";
import styles from "./ConnectedDataResponsibilitySetup.module.css";

type Account = { id: string; name: string; selected?: boolean };
type AccountState = { loading: boolean; error: string | null; items: Account[] };

type Props = {
  workspaceId: string;
  sources: DashboardSourceItem[];
  monitoringAvailable: boolean;
  drafts?: DataHealthSetupDraft[];
  preferredDraftId?: string | null;
  onSaved?: () => void | Promise<unknown>;
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

export function ConnectedDataResponsibilitySetup(props: Props) {
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const draft = props.drafts?.find(item => item.id === (selectedDraftId ?? props.preferredDraftId)) ?? props.drafts?.[0];
  return <div>
    {(props.drafts?.length ?? 0) > 1 && <label className={styles.draftPicker}>Saved setup
      <select value={draft?.id} onChange={event => setSelectedDraftId(event.target.value)}>
        {props.drafts?.map(item => <option key={item.id} value={item.id}>{item.scopes.length} accounts · {new Date(item.updatedAt).toLocaleDateString()}</option>)}
      </select>
    </label>}
    <DataHealthSetupEditor key={`${props.workspaceId}:${draft?.id ?? "new"}`} {...props} draft={draft} />
  </div>;
}

function scopeSignature(items: Array<{ connectionId: string; providerAccountId: string }>) {
  return JSON.stringify(items.map(item => [item.connectionId, item.providerAccountId]).sort());
}

function DataHealthSetupEditor({ workspaceId, sources, monitoringAvailable, onActivated, onSaved, draft }: Props & { draft?: DataHealthSetupDraft }) {
  const [accounts, setAccounts] = useState<Record<string, AccountState>>(() => {
    const initial: Record<string, AccountState> = {};
    for (const scope of draft?.scopes ?? []) {
      const entry = initial[scope.connectionId] ??= { loading: false, error: null, items: [] };
      entry.items.push({ id: scope.providerAccountId, name: scope.accountName ?? scope.providerAccountId });
    }
    return initial;
  });
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(
    (draft?.scopes ?? []).map(scope => [`${scope.connectionId}:${scope.providerAccountId}`, true])
  ));
  const [savedDraft, setSavedDraft] = useState(draft);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState("");
  const [done, setDone] = useState(false);
  const [showSetup, setShowSetup] = useState(monitoringAvailable || Boolean(draft));
  const requestId = useRef<string | null>(null);
  const pending = useRef(false);

  const loadAccounts = async (source: DashboardSourceItem) => {
    setConsented(false);
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
    setConsented(false);
    setSavedNotice("");
    setSelected(previous => ({ ...previous, [`${connectionId}:${accountId}`]: checked }));
  };

  const selectableSources = sources.filter(source =>
    source.state !== "disconnected" && ["meta_ads", "google_ads", "tiktok_business"].includes(source.provider)
  );
  const unavailableSavedScopes = savedDraft?.scopes.filter(scope => !selectableSources.some(source => source.id === scope.connectionId)) ?? [];
  const scopeItems = selectableSources.flatMap(source => (accounts[source.id]?.items ?? [])
    .filter(account => selected[`${source.id}:${account.id}`])
    .map(account => ({ connectionId: source.id, provider: source.provider, providerAccountId: account.id, accountName: account.name })));

  const persistDraft = async () => {
    if (savedDraft && scopeSignature(scopeItems) === scopeSignature(savedDraft.scopes)) return savedDraft;
    const body = savedDraft
      ? { workspaceId, expectedVersion: savedDraft.version, scopeItems }
      : {
          workspaceId, draftRequestId: requestId.current ??= crypto.randomUUID(), kind: "data_health",
          configuration: { recoveryPolicy: "retry_failed_window", permittedRecoveryModes: ["retry_failed_window"] },
          cadence: "daily", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", scopeItems,
        };
    const result = await responseJson(await fetch(savedDraft
      ? `/api/agent-console/responsibilities/${encodeURIComponent(savedDraft.id)}`
      : "/api/agent-console/responsibilities", {
      method: savedDraft ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    const saved: DataHealthSetupDraft = { ...result.responsibility, scopes: result.scopes };
    setSavedDraft(saved);
    return saved;
  };

  const submit = async (approve: boolean) => {
    if ((approve && (!consented || !monitoringAvailable || unavailableSavedScopes.length > 0)) || scopeItems.length === 0 || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSavedNotice("");
    try {
      const saved = await persistDraft();
      if (!approve) {
        setSavedNotice("Draft saved. No checks or retries have started.");
        await onSaved?.();
        return;
      }
      await responseJson(await fetch(`/api/agent-console/responsibilities/${encodeURIComponent(saved.id)}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId, expectedVersion: saved.version, scopeHash: await canonicalScopeHash(scopeItems),
          allowlistedTools: ["submit_recovery_import"],
          allowedPairs: scopeItems.map(({ connectionId, provider, providerAccountId }) => ({ connectionId, provider, providerAccountId })),
          limits: { permittedRecoveryModes: ["retry_failed_window"] },
        }),
      }));
      setDone(true);
      await onActivated();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  if (done) return null;
  if (!showSetup && !monitoringAvailable) return <section className={styles.card} aria-labelledby="data-health-setup-title">
    <div className={styles.intro}>
      <p className={styles.eyebrow}>MONITORING STATUS</p>
      <h2 id="data-health-setup-title">Connected data checks are unavailable</h2>
      <p>Daily checks are not available in this workspace yet. Save your source choices now and approve them when monitoring becomes available.</p>
    </div>
    <button type="button" className={styles.secondary} onClick={() => setShowSetup(true)}>Prepare a draft</button>
  </section>;

  return (
    <section className={styles.card} aria-labelledby="data-health-setup-title">
      <div className={styles.intro}>
        <p className={styles.eyebrow}>ONGOING RESPONSIBILITY</p>
        <h2 id="data-health-setup-title">Keep my connected data healthy</h2>
        {savedDraft?.goalLabel && <p>Setup goal: {savedDraft.goalLabel}</p>}
        {savedDraft && <p className={styles.draftStatus} role="status">Saved draft · monitoring has not started. Review your choices before approval.</p>}
        {!monitoringAvailable && <p className={styles.muted}>Daily checks are unavailable in this workspace. You can save your choices and approve later when monitoring becomes available.</p>}
        <p>Choose the sources and accounts Monstera should check. Nothing starts until you review and approve this responsibility.</p>
      </div>

      {unavailableSavedScopes.length > 0 && <p className={styles.muted} role="status">
        {unavailableSavedScopes.length} saved accounts are no longer available. Reconnect their sources, or save the remaining choices before approval.
      </p>}
      <div className={styles.sources}>
        {selectableSources.map(source => {
          const state = accounts[source.id] ?? { loading: false, error: null, items: [] };
          return (
            <fieldset key={source.id} className={styles.source}>
              <legend>{source.name}</legend>
              <button type="button" className={styles.secondary} onClick={() => void loadAccounts(source)} disabled={state.loading || busy}>
                  {state.loading ? "Loading accounts…" : state.items.length ? "Refresh account choices" : "Choose accounts"}
              </button>
              {state.error && <p className={styles.error} role="alert">{state.error}</p>}
              {state.items.map(account => {
                const key = `${source.id}:${account.id}`;
                return (
                  <label className={styles.account} key={key}>
                    <input type="checkbox" checked={Boolean(selected[key])} disabled={busy} onChange={event => toggleAccount(source.id, account.id, event.target.checked)} />
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
        <p><strong>Check schedule</strong><span>Daily{savedDraft ? ` · ${savedDraft.timezone}` : ""}</span></p>
        <p><strong>Permitted recovery</strong><span>Retry failed imports for the accounts you select</span></p>
        <p><strong>If access expires</strong><span>Ask you to reconnect; Monstera will not change campaigns or deliver reports</span></p>
      </div>

      <label className={styles.consent}>
        <input type="checkbox" checked={consented} disabled={busy || !monitoringAvailable} onChange={event => setConsented(event.target.checked)} />
        <span>I approve daily checks and retries of failed imports for the selected accounts under the policy above.</span>
      </label>
      {error && <p className={styles.error} role="alert">{error} Your saved draft can be reviewed after refreshing.</p>}
      {savedNotice && <p role="status" className={styles.muted}>{savedNotice}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={scopeItems.length === 0 || busy} onClick={() => void submit(false)}>
          {busy ? "Saving…" : "Save draft"}
        </button>
        <button type="button" className={styles.primary} disabled={!consented || !monitoringAvailable || unavailableSavedScopes.length > 0 || scopeItems.length === 0 || busy} onClick={() => void submit(true)}>
          {busy ? "Saving…" : "Approve and start daily checks"}
        </button>
      </div>
    </section>
  );
}
