"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleAlert, Database } from "lucide-react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

type RouteSource = {
  name: string;
  logo: string;
  coverage: string;
  note: string;
  status: string;
  statusTone: "ready" | "conditional";
  sheetsHref: string;
  lookerHref: string;
};

const DESTINATIONS = [
  { name: "Google Sheets", logo: INTEGRATION_LOGOS.googleSheets, descriptor: "Flexible analysis and exports" },
  { name: "Looker Studio", logo: INTEGRATION_LOGOS.looker, descriptor: "Shared visual reporting" },
] as const;

export function IntegrationRouteExplorer({ sources }: { sources: RouteSource[] }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [destinationIndex, setDestinationIndex] = useState(0);
  const selected = sources[sourceIndex];
  const destination = DESTINATIONS[destinationIndex];
  const href = destinationIndex === 0 ? selected.sheetsHref : selected.lookerHref;

  return <div className="if-route-explorer">
    <div className="if-route-header"><span>MONSTERA / ROUTE EXPLORER</span><span><i />{sources.length * DESTINATIONS.length} PUBLIC ROUTES</span></div>
    <div className="if-route-columns">
      <div className="if-route-picker"><span className="if-mono">01 / START WITH A SOURCE</span><div className="if-source-options" role="group" aria-label="Choose data source">{sources.map((source, index) => <button key={source.name} type="button" aria-pressed={sourceIndex === index} onClick={() => setSourceIndex(index)}><IntegrationMark src={source.logo} alt="" size="sm" /><span>{source.name}</span><ArrowRight size={15} /></button>)}</div></div>
      <div className="if-route-center" key={selected.name + destination.name} aria-live="polite"><span className="if-mono">02 / THROUGH YOUR WORKSPACE</span><div className="if-data-symbol"><Database size={26} strokeWidth={1.25} /></div><h3>One place to check the data.</h3><p>{selected.coverage}. Review import outcomes and reporting dates before you use the figures.</p><div className="if-evidence"><span><Check size={13} />Import outcome</span><span><Check size={13} />Metric dates</span><span><Check size={13} />Row coverage</span></div><div className={selected.statusTone === "conditional" ? "if-coverage-note is-conditional" : "if-coverage-note"}>{selected.statusTone === "conditional" ? <CircleAlert size={15} /> : <Check size={15} />}{selected.note}</div></div>
      <div className="if-route-picker if-route-end"><span className="if-mono">03 / SEND IT WHERE YOU WORK</span><div className="if-dest-options" role="group" aria-label="Choose reporting destination">{DESTINATIONS.map((item, index) => <button key={item.name} type="button" aria-pressed={destinationIndex === index} onClick={() => setDestinationIndex(index)}><IntegrationMark src={item.logo} alt="" size="sm" /><span>{item.name}<small>{item.descriptor}</small></span><ArrowRight size={15} /></button>)}</div><Link className="if-route-cta" href={href}>Explore the {selected.name} → {destination.name} route<ArrowRight size={15} /></Link></div>
    </div>
    <p className="if-route-foot">Choose any source and destination to inspect its exact setup, coverage, and limitations. The workspace preview above is illustrative.</p>
  </div>;
}
