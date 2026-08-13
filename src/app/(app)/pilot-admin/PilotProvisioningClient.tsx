"use client";

import { FormEvent, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

const providers = [
  ["meta_ads", "Meta Ads"],
  ["google_ads", "Google Ads"],
  ["tiktok_business", "TikTok Ads"],
  ["shopee", "Shopee"],
] as const;

export function PilotProvisioningClient() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");

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
          plan: form.get("plan"),
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

  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-10">
      <p className="text-xs font-bold uppercase tracking-widest text-cyan-700">Internal operations</p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">Provision pilot agency</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">Create a seven-day owner invitation. The workspace is created only after the invited owner accepts.</p>
      <form onSubmit={submit} className="mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <label className="grid gap-2 text-sm font-medium">Agency name<input name="agencyName" required className="rounded-lg border border-slate-300 bg-transparent px-3 py-2" /></label>
        <label className="grid gap-2 text-sm font-medium">Workspace slug<input name="agencySlug" required pattern="[a-z0-9-]{3,}" className="rounded-lg border border-slate-300 bg-transparent px-3 py-2" /></label>
        <label className="grid gap-2 text-sm font-medium">Owner email<input name="email" required type="email" className="rounded-lg border border-slate-300 bg-transparent px-3 py-2" /></label>
        <label className="grid gap-2 text-sm font-medium">Plan<select name="plan" defaultValue="pilot" className="rounded-lg border border-slate-300 bg-transparent px-3 py-2"><option value="pilot">Pilot</option><option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option></select></label>
        <fieldset><legend className="text-sm font-medium">Enabled providers</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{providers.map(([id, label]) => <label key={id} className="flex items-center gap-2 text-sm"><input name={id} type="checkbox" defaultChecked /> {label}</label>)}</div></fieldset>
        {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <button disabled={busy} className="flex items-center justify-center rounded-lg bg-cyan-700 px-4 py-3 font-semibold text-white hover:bg-cyan-800 disabled:opacity-60">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create owner invitation"}</button>
      </form>
      {invitationUrl ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><div className="flex items-center gap-2 font-semibold"><Check className="h-5 w-5" />Invitation ready</div><div className="mt-3 flex gap-2"><input readOnly value={invitationUrl} className="min-w-0 flex-1 rounded border border-emerald-300 bg-white px-3 py-2 text-sm" /><button type="button" onClick={() => navigator.clipboard.writeText(invitationUrl)} aria-label="Copy invitation URL" className="rounded border border-emerald-300 bg-white px-3"><Copy className="h-4 w-4" /></button></div></div> : null}
    </main>
  );
}
