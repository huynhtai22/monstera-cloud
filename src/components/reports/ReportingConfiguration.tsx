"use client";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { REPORT_DESTINATIONS, REPORT_PROVIDERS } from "@/lib/reporting-context";

type Account = { connectionId: string; accountId: string; context: null | {
  providerTimezone: string | null; providerCurrency: string | null; providerObservedAt: string | null;
  overrideTimezone: string | null; overrideCurrency: string | null; overrideReason: string | null;
} };
type Configuration = { canEdit: boolean; requiredProviders: string[]; requiredDestinations: string[]; requirementsConfiguredAt: string | null; accounts: Account[] };
const field = "mt-1 w-full rounded-md border border-line bg-canvas p-2 text-ink";
async function fetchConfiguration(url: string): Promise<Configuration> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Configuration unavailable");
  return res.json();
}
export function ReportingConfiguration({ workspaceId, clientId, onSaved }: { workspaceId: string; clientId: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(open ? `/api/reports/readiness/configuration?${new URLSearchParams({ workspaceId, clientId })}` : null, fetchConfiguration, { keepPreviousData: false, errorRetryCount: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(payload: object) {
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/reports/readiness/configuration", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, clientId, ...payload }) });
      if (!res.ok) throw new Error((await res.json()).error || "Could not save");
      await mutate(); setMessage("Saved. Retrieve the reporting window again to refresh delivery evidence."); onSaved?.();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Could not save. Please retry."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 min-w-0 text-xs">
    <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="text-ink underline">{open ? "Close reporting configuration" : "Configure reporting evidence"}</button>
    {open ? <div className="mt-3 space-y-4 rounded-lg border border-line p-3 text-ink-mute">
      {isLoading ? <p>Loading reporting configuration…</p> : error ? <p role="alert">Configuration unavailable. <button type="button" className="underline" onClick={() => void mutate()}>Retry configuration</button></p> : data ? <>
        <p>{data.canEdit ? "Owners and admins can configure reporting evidence." : "Read-only. Ask a workspace owner or admin to make changes."}</p>
        <p className="break-all">Client ID for destination configuration: <code>{clientId}</code></p>
        <form key={JSON.stringify([data.requiredProviders, data.requiredDestinations])} onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void save({ requirements: { providers: form.getAll("providers"), destinations: form.getAll("destinations") } });
        }}>
          <fieldset disabled={!data.canEdit || busy} className="space-y-3">
            <legend className="font-medium text-ink">Required sources and delivery</legend>
            <p>{data.requirementsConfiguredAt ? "Explicit client requirements" : "Unconfigured — assigned-source inference is only a fallback."}</p>
            <div className="grid gap-2 sm:grid-cols-2">{REPORT_PROVIDERS.map(p => <label key={p} className="flex items-center gap-2"><input type="checkbox" name="providers" value={p} defaultChecked={data.requiredProviders.includes(p)} />{p.replaceAll("_", " ")}</label>)}</div>
            <p>Select every destination this client requires:</p>
            <div className="flex flex-wrap gap-3">{REPORT_DESTINATIONS.map(d => <label key={d} className="flex items-center gap-2"><input type="checkbox" name="destinations" value={d} defaultChecked={data.requiredDestinations.includes(d)} />{d === "google_sheets" ? "Google Sheets" : "Looker Studio"}</label>)}</div>
            {data.canEdit ? <button className="rounded-md border border-line px-3 py-2 text-ink" type="submit">Save requirements</button> : null}
          </fieldset>
        </form>
        <div><h5 className="font-medium text-ink">Account reporting context</h5><p className="mt-1">Use the provider’s reporting timezone and currency, not your browser locale. Overrides retain provider facts; disagreements block readiness. Blank overrides restore provider values.</p></div>
        {!data.accounts.length ? <p>No known accounts yet. Connect and import a source first.</p> : null}
        {data.accounts.map(a => <form key={JSON.stringify(a)} className="rounded-md border border-line p-3" onSubmit={event => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void save({ override: { connectionId: a.connectionId, accountId: a.accountId, timezone: String(form.get("timezone") || "").trim() || null, currency: String(form.get("currency") || "").trim() || null, reason: form.get("reason") } });
        }}>
          <fieldset disabled={!data.canEdit || busy} className="space-y-2">
            <legend className="break-all font-medium text-ink">Account {a.accountId}</legend>
            <p className="break-all">Source {a.connectionId}</p>
            <p>Provider: {a.context?.providerTimezone || "Timezone unknown"} · {a.context?.providerCurrency || "Currency unknown"}</p>
            <p>Observed: {a.context?.providerObservedAt ? new Date(a.context.providerObservedAt).toLocaleString() : "Not recorded"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>Timezone override<input name="timezone" className={field} placeholder="e.g. Asia/Ho_Chi_Minh" maxLength={100} defaultValue={a.context?.overrideTimezone || ""} /></label>
              <label>Currency override<input name="currency" className={field} placeholder="e.g. VND" maxLength={3} defaultValue={a.context?.overrideCurrency || ""} /></label>
            </div>
            <label className="block">Verification reason<input name="reason" required minLength={10} maxLength={500} className={field} placeholder="How you verified these values" defaultValue={a.context?.overrideReason || ""} /></label>
            {data.canEdit ? <button type="submit" className="rounded-md border border-line px-3 py-2 text-ink">Save account context</button> : null}
          </fieldset>
        </form>)}
        <p>Delivery is recorded only by an authenticated, complete, unfiltered client/window retrieval. A connection, preview, cache hit, or a partial page is not verification. A receipt confirms server retrieval, not that a human viewed the report.</p>
      </> : null}
      {message ? <p role="status" className="text-ink">{message}</p> : null}
    </div> : null}
  </div>;
}
