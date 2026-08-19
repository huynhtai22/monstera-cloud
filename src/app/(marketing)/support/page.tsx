export default function SupportPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 pt-28 pb-20 font-sans text-ink">
      <div className="mb-10">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-line bg-panel text-ink-mute text-xs font-semibold uppercase tracking-wider mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
          <span>Help &amp; Documentation</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-ink">Support</h1>
        <p className="mt-2 text-xs sm:text-sm text-ink-mute leading-relaxed">
          Need help connecting data sources or setting up dashboards? We can help.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel p-6">
          <h2 className="text-sm font-bold text-ink">Common issues</h2>
          <ul className="mt-4 space-y-2.5 text-xs text-ink-mute">
            <li>
              <span className="font-semibold text-ink">Looker Studio connector:</span>{" "}
              generate a workspace API key, paste it into the connector, and select a platform filter.
            </li>
            <li>
              <span className="font-semibold text-ink">OAuth redirects:</span>{" "}
              ensure you start the connect flow from <span className="font-mono text-ink">monsteracloud.com</span> (not localhost),
              and register the exact redirect URI in the provider console.
            </li>
            <li>
              <span className="font-semibold text-ink">No data in reports:</span>{" "}
              run “Sync Now” on a pipeline, then check <span className="font-mono text-ink">/reports</span> for logs.
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-line bg-panel p-6">
          <h2 className="text-sm font-bold text-ink">Contact</h2>
          <p className="mt-4 text-xs text-ink-mute">
            Email us and include your workspace name and a screenshot of the error.
          </p>
          <div className="mt-4 rounded-md border border-line bg-canvas p-3 text-xs text-ink">
            <div className="text-[11px] text-ink-mute">Support email</div>
            <div className="mt-1 font-mono text-accent">support@monsteracloud.com</div>
          </div>
          <p className="mt-4 text-[11px] text-ink-mute">
            Response times vary; we typically reply within 24–48 hours.
          </p>
          <p className="mt-3 text-[11px] text-ink-mute">
            <span className="font-semibold text-ink">SEA:</span> Prefer quick chat? Email with the subject &quot;Telegram&quot; and your
            workspace name — we&apos;ll share our community channel link where available (Singapore / Vietnam business hours).
          </p>
        </div>
      </div>
    </div>
  );
}

