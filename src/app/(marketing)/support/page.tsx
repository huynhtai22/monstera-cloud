export default function SupportPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Support</h1>
        <p className="mt-3 text-sm text-slate-400">
          Need help connecting data sources or setting up dashboards? We can help.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
          <h2 className="text-base font-bold text-white">Common issues</h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-300">
            <li>
              <span className="font-semibold text-slate-200">Looker Studio connector:</span>{" "}
              generate a workspace API key, paste it into the connector, and select a platform filter.
            </li>
            <li>
              <span className="font-semibold text-slate-200">OAuth redirects:</span>{" "}
              ensure you start the connect flow from <span className="font-mono">monsteracloud.com</span> (not localhost),
              and register the exact redirect URI in the provider console.
            </li>
            <li>
              <span className="font-semibold text-slate-200">No data in reports:</span>{" "}
              run “Sync Now” on a pipeline, then check <span className="font-mono">/reports</span> for logs.
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
          <h2 className="text-base font-bold text-white">Contact</h2>
          <p className="mt-4 text-sm text-slate-300">
            Email us and include your workspace name and a screenshot of the error.
          </p>
          <div className="mt-4 rounded-xl border border-slate-800 bg-black/20 p-4 text-sm text-slate-200">
            <div className="text-slate-400">Support email</div>
            <div className="mt-1 font-mono">support@monsteracloud.com</div>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Response times vary; we typically reply within 24–48 hours.
          </p>
          <p className="mt-4 text-xs text-slate-500">
            <span className="font-semibold text-slate-400">SEA:</span> Prefer quick chat? Email with the subject &quot;Telegram&quot; and your
            workspace name — we&apos;ll share our community channel link where available (Singapore / Vietnam business hours).
          </p>
        </div>
      </div>
    </div>
  );
}

