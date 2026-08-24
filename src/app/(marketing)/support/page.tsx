import type { Metadata } from "next";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Support and troubleshooting",
  description: "Troubleshoot Monstera source authorization, warehouse imports, Google Sheets, and Looker Studio workflows.",
  alternates: { canonical: `${PRODUCT_SITE_URL}/support` },
};

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedPlan = firstParam(params.plan);
  const requestedAudience = firstParam(params.audience);
  const planLabel = requestedPlan ? PLAN_LABELS[requestedPlan] : undefined;
  const requestContext = planLabel
    ? `${planLabel} plan`
    : requestedAudience === "agency"
      ? "agency pilot"
      : "pilot access";
  const isPilotRequest = firstParam(params.pilot) === "1" || Boolean(planLabel || requestedAudience);
  const subject = encodeURIComponent(`Monstera Cloud ${requestContext} request`);
  const body = encodeURIComponent(
    `Requested: ${requestContext}\n\nWorkspace or company name:\nData sources:\nDestination (Google Sheets or Looker Studio):\nWorkspace count:\n`,
  );
  const contactHref = `mailto:support@monsteracloud.com?subject=${subject}&body=${body}`;

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

      {isPilotRequest ? (
        <section className="mb-6 flex flex-col gap-5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.045] p-6 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="pilot-request-heading">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Pilot request</p>
              <h2 id="pilot-request-heading" className="mt-2 text-lg font-semibold text-ink">
                Continue with the {requestContext}
              </h2>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-ink-mute">
                Your selected context is preserved. Add your sources, destination, and workspace count so we can confirm access and capacity before activation.
              </p>
            </div>
          </div>
          <a href={contactHref} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-white px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-neutral-200">
            Email pilot request
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </section>
      ) : null}

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
              verify the selected workspace, account, and date range, then review the final outcome in Sync activity before retrying.
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-line bg-panel p-6">
          <h2 className="text-sm font-bold text-ink">Contact</h2>
          <p className="mt-4 text-xs text-ink-mute">
            Email us and include your workspace name and a screenshot of the error.
          </p>
          <a href={contactHref} className="mt-4 block rounded-md border border-line bg-canvas p-3 text-xs text-ink transition-colors hover:border-white/25 hover:bg-white/[0.03]">
            <div className="text-[11px] text-ink-mute">Support email</div>
            <div className="mt-1 flex items-center justify-between gap-3 font-mono text-accent">
              <span>support@monsteracloud.com</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </div>
          </a>
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
