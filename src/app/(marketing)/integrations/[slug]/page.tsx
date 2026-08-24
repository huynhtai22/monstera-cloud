import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert } from "lucide-react";
import { MarketingTrustSecuritySection } from "@/components/marketing/MarketingTrustSecuritySection";
import { PRODUCT_SITE_URL } from "@/lib/site-url";
import {
  PUBLIC_INTEGRATIONS,
  publicIntegrationBySlug,
} from "@/lib/public-integrations";

export function generateStaticParams() {
  return PUBLIC_INTEGRATIONS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = publicIntegrationBySlug(slug);
  if (!data) return {};

  return {
    title: data.headline,
    description: data.description,
    keywords: [
      data.source,
      data.destination,
      "advertising data connector",
      "reporting automation",
      ...data.keywords,
    ],
    alternates: { canonical: `${PRODUCT_SITE_URL}/integrations/${data.slug}` },
    openGraph: {
      title: data.headline,
      description: data.description,
      url: `${PRODUCT_SITE_URL}/integrations/${data.slug}`,
    },
  };
}

export default async function IntegrationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = publicIntegrationBySlug(slug);
  if (!data) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-canvas font-sans text-ink">
      <section className="relative overflow-hidden border-b border-line px-4 pb-20 pt-20 sm:px-6 sm:pb-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-line bg-panel px-4 py-1.5 font-mono text-xs text-ink-mute">
            <span className="font-semibold text-ink">{data.source}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            <span className="font-semibold text-ink">{data.destination}</span>
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl md:text-6xl">
            {data.headline}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-sm leading-relaxed text-ink-mute sm:text-base">
            {data.description}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/support?pilot=1"
              className="inline-flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Request pilot access
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <Link
              href="/docs#connect-source"
              className="inline-flex items-center gap-2 rounded-md border border-line bg-panel px-6 py-2.5 text-xs font-semibold text-ink transition-colors hover:border-white/25 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Review setup steps
            </Link>
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 sm:py-24" aria-labelledby="integration-details">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">Workflow details</p>
            <h2 id="integration-details" className="mt-3 text-3xl font-semibold tracking-tight text-ink">
              What this connection supports
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-mute">
              Availability is scoped to the certified pilot path. Provider definitions and access requirements still apply.
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <DetailCard title="Reporting data" items={data.availableData} />
            <DetailCard title="Before you start" items={data.requirements} />
            <DetailCard title="Know before relying on it" items={data.limitations} caution />
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-panel/30 px-4 py-20 sm:px-6" aria-labelledby="integration-flow">
        <div className="mx-auto max-w-5xl">
          <h2 id="integration-flow" className="text-center text-3xl font-semibold tracking-tight text-ink">
            From authorization to a report you can verify
          </h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
            {[
              ["01", "Authorize", `Connect ${data.source} from the selected Monstera workspace.`],
              ["02", "Import", "Choose a date window and run the first warehouse refresh."],
              ["03", "Verify", "Inspect the outcome, row count, and latest metric date in Data Explorer."],
              ["04", "Report", `Open the ${data.destination} workflow and query the verified workspace data.`],
            ].map(([number, title, description]) => (
              <li key={number} className="bg-panel p-6">
                <span className="font-mono text-[11px] text-emerald-400">{number}</span>
                <h3 className="mt-5 text-sm font-semibold text-ink">{title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-ink-mute">{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6" aria-labelledby="integration-faq">
        <div className="mx-auto max-w-3xl">
          <h2 id="integration-faq" className="text-center text-2xl font-semibold text-ink">Common questions</h2>
          <ul className="mt-8 space-y-4">
            {data.faqs.map((item) => (
              <li key={item.question} className="rounded-lg border border-line bg-panel p-6">
                <h3 className="text-sm font-semibold text-ink">{item.question}</h3>
                <p className="mt-2 text-xs leading-relaxed text-ink-mute">{item.answer}</p>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex justify-center">
            <Link href="/integrations" className="text-sm font-medium text-ink-mute underline decoration-line underline-offset-4 hover:text-ink">
              Compare all certified connector workflows
            </Link>
          </div>
        </div>
      </section>

      <MarketingTrustSecuritySection />
    </div>
  );
}

function DetailCard({
  title,
  items,
  caution = false,
}: {
  title: string;
  items: readonly string[];
  caution?: boolean;
}) {
  const Icon = caution ? CircleAlert : CheckCircle2;
  return (
    <article className="rounded-xl border border-line bg-panel p-6">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-xs leading-relaxed text-ink-mute">
            <Icon className={caution ? "mt-0.5 h-4 w-4 shrink-0 text-amber-300" : "mt-0.5 h-4 w-4 shrink-0 text-emerald-400"} aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
