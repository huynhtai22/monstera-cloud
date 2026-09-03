"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import type { PilotActivationState } from "@/lib/pilot-activation";

const providers = [
  ["meta_ads", "Meta Ads"],
  ["google_ads", "Google Ads"],
  ["tiktok_business", "TikTok Ads"],
  ["shopee", "Shopee"],
] as const;

interface RecentOrder {
  orderCode: number;
  plan: string;
  billingCycle: string;
  amount: number;
  memo: string;
  status: string;
  userEmail?: string;
  createdAt: number;
}

interface PilotWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  status: string;
  plan: string;
  trialEndsAt: string | null;
  daysRemaining: number | null;
  milestone: PilotActivationState["currentStep"];
  recentRows: number;
  dataThroughDate: string | null;
  blockingSource: { id: string; name: string; reason: string | null } | null;
  lastProgressAt: string;
  activation: PilotActivationState;
}

interface SchemaProposal {
  id: string;
  provider: string;
  connectionId: string;
  status: string;
  breaking: boolean;
  note: string | null;
}

const milestoneLabels: Record<PilotWorkspaceRow["milestone"], string> = {
  connect_source: "Connect source",
  import_data: "Import data",
  fix_source: "Fix source",
  review_dashboard: "Review dashboard",
  complete: "Activated",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function PilotProvisioningClient() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [workspaces, setWorkspaces] = useState<PilotWorkspaceRow[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [proposals, setProposals] = useState<SchemaProposal[]>([]);
  const [proposalBusy, setProposalBusy] = useState(false);

  const loadRecentOrders = useCallback(() => {
    setLoadingOrders(true);
    fetch("/api/payments/vietqr/manual-confirm")
      .then((response) => response.json())
      .then((body) => {
        if (Array.isArray(body.orders)) setRecentOrders(body.orders);
      })
      .catch(() => {})
      .finally(() => setLoadingOrders(false));
  }, []);

  const loadWorkspaces = useCallback(() => {
    setLoadingWorkspaces(true);
    fetch("/api/internal/pilot/workspaces?limit=50")
      .then((response) => response.json())
      .then((body) => {
        if (Array.isArray(body.workspaces)) setWorkspaces(body.workspaces);
      })
      .catch(() => {})
      .finally(() => setLoadingWorkspaces(false));
  }, []);

  const loadProposals = useCallback(() => {
    fetch("/api/pilot-admin/schema-proposals")
      .then((response) => (response.ok ? response.json() : { proposals: [] }))
      .then((body) => {
        if (Array.isArray(body.proposals)) setProposals(body.proposals);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadRecentOrders();
    loadWorkspaces();
    loadProposals();
  }, [loadProposals, loadRecentOrders, loadWorkspaces]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInvitationUrl("");
    const form = new FormData(event.currentTarget);
    const enabledProviders = providers.map(([id]) => id).filter((id) => form.get(id) === "on");
    try {
      const response = await fetch("/api/internal/pilot/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agencyName: form.get("agencyName"),
          agencySlug: form.get("agencySlug"),
          email: form.get("email"),
          enabledProviders,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Provisioning failed");
      setInvitationUrl(body.invitationUrl);
      event.currentTarget.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Provisioning failed");
    } finally {
      setBusy(false);
    }
  }

  const scanProposals = async () => {
    setProposalBusy(true);
    try {
      await fetch("/api/pilot-admin/schema-proposals", { method: "POST" });
      loadProposals();
    } finally {
      setProposalBusy(false);
    }
  };

  const decideProposal = async (id: string, decision: "approved" | "rejected") => {
    const response = await fetch(`/api/pilot-admin/schema-proposals/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(typeof body.message === "string" ? body.message : "Could not apply mapping decision");
    }
    loadProposals();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-8 p-6 sm:p-10">
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-mute">Internal operations</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Pilot activation control</h1>
        <p className="mt-1 text-xs text-ink-mute">Invite seven-day Agency Pro pilots, monitor activation blockers, and inspect PayOS webhook outcomes.</p>
      </div>

      <section className="rounded-lg border border-line bg-panel p-6" aria-labelledby="pilot-table-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="pilot-table-title" className="text-base font-bold text-ink">Activation pipeline</h2>
            <p className="mt-1 text-xs text-ink-mute">Database-derived milestones, sorted by blocked or expiring pilots first.</p>
          </div>
          <button type="button" onClick={loadWorkspaces} aria-label="Refresh activation pipeline" className="rounded-md border border-line p-2 text-ink-mute hover:text-ink">
            <RefreshCw className={`h-4 w-4 ${loadingWorkspaces ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-xs">
            <thead><tr className="border-b border-line font-mono text-[10px] uppercase tracking-wider text-ink-mute"><th className="px-3 py-2.5">Workspace / owner</th><th className="px-3 py-2.5">Trial</th><th className="px-3 py-2.5">Milestone</th><th className="px-3 py-2.5">Rows 7d</th><th className="px-3 py-2.5">Data through</th><th className="px-3 py-2.5">Blocker</th><th className="px-3 py-2.5">Last progress</th></tr></thead>
            <tbody className="divide-y divide-line">
              {workspaces.map((workspace) => (
                <tr key={workspace.id} className="align-top hover:bg-white/[0.025]">
                  <td className="px-3 py-3"><p className="font-semibold text-ink">{workspace.name}</p><p className="mt-0.5 text-ink-mute">{workspace.ownerEmail ?? "Owner unavailable"}</p></td>
                  <td className="px-3 py-3"><p className={workspace.daysRemaining === 0 ? "font-semibold text-red-300" : "text-ink"}>{workspace.daysRemaining === null ? "Legacy / undated" : `${workspace.daysRemaining}d left`}</p><p className="mt-0.5 text-ink-mute">{formatTimestamp(workspace.trialEndsAt)}</p></td>
                  <td className="px-3 py-3"><span className="rounded-full border border-line bg-canvas px-2 py-1 font-semibold text-ink">{milestoneLabels[workspace.milestone]}</span></td>
                  <td className="px-3 py-3 font-mono text-ink">{workspace.recentRows.toLocaleString()}</td>
                  <td className="px-3 py-3 text-ink-mute">{formatTimestamp(workspace.dataThroughDate)}</td>
                  <td className="px-3 py-3">{workspace.blockingSource ? <Link href={`/sources/${workspace.blockingSource.id}`} className="font-semibold text-amber-300 hover:underline">{workspace.blockingSource.name}<span className="block font-normal text-ink-mute">{workspace.blockingSource.reason?.replaceAll("_", " ")}</span></Link> : <span className="text-ink-mute">—</span>}</td>
                  <td className="px-3 py-3 text-ink-mute">{formatTimestamp(workspace.lastProgressAt)}</td>
                </tr>
              ))}
              {!loadingWorkspaces && workspaces.length === 0 ? <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-mute">No pilot workspaces found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-panel p-6" aria-labelledby="invite-title">
          <h2 id="invite-title" className="text-base font-bold text-ink">Create a seven-day pilot invitation</h2>
          <p className="mt-1 text-xs text-ink-mute">New workspaces always start on the server-controlled Agency Pro pilot. The browser cannot choose a plan or duration.</p>
          <form onSubmit={submit} className="mt-5 grid gap-4">
            <label className="grid gap-1.5 text-xs font-semibold text-ink">Agency / customer name<input name="agencyName" required placeholder="Example Agency" className="rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink focus:border-white focus:outline-none" /></label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink">Workspace slug<input name="agencySlug" required pattern="[a-z0-9-]{3,}" placeholder="example-agency" className="rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink focus:border-white focus:outline-none" /></label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink">Owner email<input name="email" required type="email" placeholder="owner@agency.vn" className="rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink focus:border-white focus:outline-none" /></label>
            <fieldset><legend className="mb-2 text-xs font-semibold text-ink">Enabled sources</legend><div className="grid grid-cols-2 gap-2">{providers.map(([id, label]) => <label key={id} className="flex items-center gap-2 text-xs text-ink-mute"><input name={id} type="checkbox" defaultChecked className="accent-white" /> {label}</label>)}</div></fieldset>
            {error ? <p role="alert" className="rounded-md border border-red-900/40 bg-red-950/30 p-3 text-xs font-semibold text-red-200">{error}</p> : null}
            <button disabled={busy} className="mt-2 flex items-center justify-center rounded-md bg-white px-4 py-2.5 text-xs font-bold text-black hover:bg-neutral-200 disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create pilot invitation"}</button>
          </form>
          {invitationUrl ? <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-emerald-200"><Check className="h-4 w-4" /> Invitation created</div><div className="mt-2 flex gap-2"><input readOnly value={invitationUrl} className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-xs text-ink" /><button type="button" onClick={() => navigator.clipboard.writeText(invitationUrl)} aria-label="Copy invitation URL" className="rounded-md border border-line bg-canvas px-3 py-1.5"><Copy className="h-4 w-4 text-ink" /></button></div></div> : null}
        </section>

        <section className="rounded-lg border border-line bg-panel p-6" aria-labelledby="orders-title">
          <div className="flex items-start justify-between gap-3"><div><h2 id="orders-title" className="text-base font-bold text-ink">PayOS order history</h2><p className="mt-1 text-xs text-ink-mute">Read-only. A verified PayOS webhook is the only path that activates or extends a subscription.</p></div><button type="button" onClick={loadRecentOrders} aria-label="Refresh PayOS order history" className="rounded-md border border-line p-2 text-ink-mute hover:text-ink"><RefreshCw className={`h-4 w-4 ${loadingOrders ? "animate-spin" : ""}`} /></button></div>
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[560px] border-collapse text-left text-xs"><thead><tr className="border-b border-line font-mono text-[10px] uppercase tracking-wider text-ink-mute"><th className="px-2 py-2.5">Order</th><th className="px-2 py-2.5">Plan</th><th className="px-2 py-2.5">Amount</th><th className="px-2 py-2.5">Status</th></tr></thead><tbody className="divide-y divide-line">{recentOrders.map((order) => <tr key={order.orderCode}><td className="px-2 py-3 font-mono text-ink">#{order.orderCode}</td><td className="px-2 py-3 text-ink">{order.plan} · {order.billingCycle}</td><td className="px-2 py-3 font-semibold text-ink">{order.amount.toLocaleString("vi-VN")} ₫</td><td className="px-2 py-3"><span className="rounded-full border border-line bg-canvas px-2 py-1 font-semibold text-ink">{order.status}</span></td></tr>)}{!loadingOrders && recentOrders.length === 0 ? <tr><td colSpan={4} className="px-2 py-8 text-center text-ink-mute">No recent PayOS orders.</td></tr> : null}</tbody></table></div>
        </section>
      </div>

      <section className="space-y-4 rounded-lg border border-line bg-panel p-6">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-ink">Mapping copilot</h2><p className="text-xs text-ink-mute">Operator-only mapping review. Breaking changes still require an engineer PR.</p></div><button type="button" onClick={() => void scanProposals()} disabled={proposalBusy} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50">{proposalBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Scan discoveries</button></div>
        {proposals.length === 0 ? <p className="text-xs text-ink-mute">No pending mapping proposals.</p> : <ul className="space-y-2 text-xs">{proposals.map((proposal) => <li key={proposal.id} className="space-y-1 rounded-md border border-line p-3"><div className="font-semibold text-ink">{proposal.provider} · {proposal.connectionId.slice(-6)} · {proposal.status}{proposal.breaking ? " · breaking" : ""}</div><div className="text-ink-mute">{proposal.note}</div>{proposal.status === "pending" ? <div className="flex gap-2 pt-1">{proposal.breaking ? <span className="text-ink-mute">Engineer PR required</span> : <button type="button" className="rounded border border-line px-2 py-1" onClick={() => void decideProposal(proposal.id, "approved")}>Apply overlay</button>}<button type="button" className="rounded border border-line px-2 py-1" onClick={() => void decideProposal(proposal.id, "rejected")}>Reject</button></div> : null}</li>)}</ul>}
      </section>
    </main>
  );
}
