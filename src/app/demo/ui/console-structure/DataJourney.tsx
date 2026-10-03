"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Route, X } from "lucide-react";
import type { DashboardOverviewDTO } from "@/lib/dashboard-overview";
import { ConsoleSyncLabel } from "@/components/dashboard/ConsoleSyncLabel";
import s from "./journey.module.css";

/** A workspace evidence trail. A connected destination is never a delivery receipt. */
export function DataJourney({ overview, href, locationKey }: { overview: DashboardOverviewDTO; href: (path: string) => string; locationKey: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const warehouse = overview.summaryCards.warehouse;
  const sources = overview.summaryCards.sources;
  const stages = [
    { name: "Connect", state: sources.total === 0 ? "Not connected" : sources.attention ? "Needs attention" : "Connected", summary: `${sources.total} sources · ${sources.accountsTotal} accounts · ${sources.attention} need attention`, detail: "Connection access is the first step. A connected source does not confirm that its data has been imported.", facts: [["Connection health", `${sources.healthy} healthy of ${sources.total}`]], path: "/sources", action: "Review sources" },
    { name: "Import", state: ({ fresh: "Fresh", stale: "Stale", refreshing: "Importing", partial: "Partial", failed: "Failed", never: "Not imported" })[warehouse.status], summary: warehouse.dataThroughDate ? `Data through ${warehouse.dataThroughDate}` : "No data-through date recorded", detail: "Inspect imported rows and coverage before using them in a report.", facts: [["Imported rows", warehouse.totalRows.toLocaleString()], ["Last refresh", warehouse.asOf ? new Date(warehouse.asOf).toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }) + " ICT" : "Not recorded"]], path: "/explorer", action: "Inspect imported data" },
    { name: "Report", state: !overview.warehouseSnapshot.hasData ? "No data" : warehouse.status !== "fresh" ? "Review coverage" : "Data available", summary: overview.warehouseSnapshot.metrics7d.mixedCurrency ? "Separate totals by currency" : "Review definitions and coverage", detail: "Available rows are evidence for a report, not proof that every account and date is complete.", facts: [["Data through", overview.warehouseSnapshot.dataThroughDate ?? "Not recorded"], ["Currencies", overview.warehouseSnapshot.metrics7d.byCurrency.map(item => item.currency).join(", ") || "Not recorded"]], path: "/reports?view=performance", action: "Review performance" },
    { name: "Deliver", state: overview.destinationsList.length ? "Destination configured" : "Not configured", summary: "Delivery not verified by this overview", detail: "Destination setup and successful delivery are separate facts. Open the destination to review its setup and delivery evidence.", facts: [["Destinations", overview.destinationsList.map(item => item.name).join(", ") || "None"], ["Delivery receipt", "Not included in this overview"]], path: "/exports", action: "Review destinations" },
  ];
  const current = stages[selected];
  const close = async () => {
    const node = dialog.current;
    if (!node?.open) return;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      await node.animate([{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(12px)" }], { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" }).finished.catch(() => {});
    }
    node.close();
    trigger.current?.focus();
  };
  useEffect(() => { dialog.current?.close(); setOpen(false); }, [locationKey]);
  return <>
    <button ref={trigger} type="button" className={s.trigger} aria-haspopup="dialog" aria-expanded={open} onClick={() => { dialog.current?.showModal(); setOpen(true); }}><Route size={15}/>Data journey</button>
    <dialog ref={dialog} className={s.dialog} aria-labelledby="data-journey-title" onClose={() => setOpen(false)} onCancel={event => { event.preventDefault(); void close(); }}>
      <header><div><span className={s.eyebrow}>WORKSPACE EVIDENCE</span><h2 id="data-journey-title">Follow your data.</h2></div><button type="button" aria-label="Close data journey" onClick={() => void close()}><X size={18}/></button></header>
      <p className={s.scope}>{overview.workspace.name} · Workspace overview</p>
      <p className={s.intro}>See what is known at each step, then open the evidence. The linked screens preserve your client selection.</p>
      <nav className={s.stages} aria-label="Data journey stages">{stages.map((stage, index) => <button key={stage.name} type="button" aria-pressed={selected === index} aria-controls="journey-evidence" onClick={() => setSelected(index)}><span className={s.step}>{index + 1}</span><span><strong>{stage.name}</strong><small>{stage.state}</small></span>{index === 1 && warehouse.status === "refreshing" && <ConsoleSyncLabel active iconOnly idleLabel="" activeLabel="Importing data" idleIcon={null}/>}</button>)}</nav>
      <section id="journey-evidence" className={s.evidence} key={selected} aria-label={`${current.name} evidence`}><span className={s.eyebrow}>{current.state}</span><h3>{current.summary}</h3><p>{current.detail}</p><dl>{current.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><Link href={href(current.path)}>{current.action}<ArrowRight size={16}/></Link></section>
      <p className={s.note}>This preview uses sample evidence. Production will link each stage to scoped accounts, coverage, and job receipts.</p>
    </dialog>
  </>;
}
