"use client";
import { useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import type { getOnboardingHandoff } from "@/lib/agent/onboarding-handoff";
import styles from "./ConnectedDataResponsibilitySetup.module.css";

type Handoff = Awaited<ReturnType<typeof getOnboardingHandoff>>;
async function json(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || "Unable to load your saved setup");
  return body;
}
export function OnboardingHandoffCard({ workspaceId, onDraftSaved }: { workspaceId: string; onDraftSaved?: () => void | Promise<unknown> }) {
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const runId = params.get("onboardingRunId");
  const { data, error, mutate } = useSWR<Handoff>(runId ? `/api/agent/runs/${encodeURIComponent(runId)}/handoff` : null,
    async url => json(await fetch(url, { cache: "no-store" })), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState<string | null>(null);
  const lock = useRef(false);
  if (!runId) return null;
  if (error) return <section className={styles.card}><p role="status">Your saved setup could not be loaded. {error.message}</p><button className={styles.secondary} onClick={() => void mutate()}>Retry setup overview</button></section>;
  if (!data) return <p role="status">Loading your reviewed setup…</p>;
  if (data.workspaceId !== workspaceId) return <p role="status">Select the workspace used in onboarding to review this setup.</p>;
  async function prepare() {
    if (!data || lock.current) return;
    lock.current = true; setBusy(true); setActionError(null);
    try {
      const saved = await json(await fetch(`/api/agent/runs/${encodeURIComponent(runId!)}/handoff`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: data.version }),
      }));
      await onDraftSaved?.();
      const next = new URLSearchParams(params.toString());
      next.set("monitoringDraftId", saved.responsibilityId);
      router.replace(`${pathname}?${next}`, { scroll: false });
    } catch (err) { setActionError(err instanceof Error ? err.message : "Unable to prepare ongoing checks"); await mutate(); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className={styles.card} aria-labelledby="onboarding-handoff-title">
    <div className={styles.intro}><p className={styles.eyebrow}>FROM YOUR SAVED SETUP</p>
      <h2 id="onboarding-handoff-title">{data.goal?.context ?? "Your imported source data"}</h2>
      <p>These are the accounts and dates reviewed in onboarding. Source data remains separate; this overview does not certify a reconciled report.</p>
    </div>
    <div className={styles.policy}>{data.sources.map(source => <div key={source.taskId}>
      <p><strong>{source.provider.replaceAll("_", " ")}</strong><span>{source.window.since} — {source.window.until} · {source.accounts} accounts · {source.rows.toLocaleString()} rows</span>
      <span>{source.currency && source.spend !== null ? `${source.currency} ${source.spend.toLocaleString()} source-reported spend` : "Spend comparison unavailable"}</span></p>
      {source.limitations.map(item => <small className={styles.muted} key={item}>{item}. </small>)}
    </div>)}</div>
    {data.blockers.map(item => <p key={item} role="status" className={styles.muted}>{item}</p>)}
    {!data.canPrepareDraft && data.blockers.length === 0 && <p role="status">Ongoing setup is not available in this workspace yet.</p>}
    <p className={styles.muted}>Ongoing checks are optional. Review the saved accounts, daily schedule and permitted retries in a draft; approval is a separate step.</p>
    {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
    {data.canPrepareDraft && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void prepare()}>{busy ? "Preparing your draft…" : "Review ongoing checks"}</button>}
  </section>;
}
