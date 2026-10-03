"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Database, FileText, ShieldCheck, Users, X } from "lucide-react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { LogoMark } from "@/components/Logo";
import styles from "./FeatureReminder.module.css";

export type FeatureHighlight = { title: string; copy: string; link: string; path: string; label: string; artwork: 0 | 1 | 2 | 3 };

const defaultHighlights: readonly FeatureHighlight[] = [
  { title: "Your tools. One clear view.", copy: "Bring advertising and commerce data into your workspace. You choose the sources and approve access.", link: "Explore sources", path: "/sources", artwork: 0, label: "CONNECTED TOOLS" },
  { title: "Keep each client in focus.", copy: "Group the accounts behind each client’s reporting. Keep the reporting scope clear as your portfolio grows.", link: "View clients", path: "/clients", artwork: 1, label: "CLIENT CONTEXT" },
  { title: "A fleet you stay in control of.", copy: "Follow source setup and operational issues in one place. Where ongoing checks are available, review and approve their scope before activation.", link: "Open operations", path: "/operations", artwork: 2, label: "YOUR OPERATIONAL FLEET" },
  { title: "Know what reached your report.", copy: "Review source coverage, reporting dates, and delivery evidence. Inspect the destination output before treating a report as verified.", link: "Review reports", path: "/reports", artwork: 3, label: "REPORTING CONFIDENCE" },
];

function Grid() {
  return <span className={styles.grid}>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</span>;
}

function Illustration({ slide }: { slide: number }) {
  return <div className={styles.illustration} aria-hidden="true" data-reminder-art={slide}>
    {slide === 0 && <><div className={styles.floatingTools}>{[INTEGRATION_LOGOS.meta, INTEGRATION_LOGOS.googleAds, INTEGRATION_LOGOS.shopee].map((src, i) => <span key={src} style={{ "--i": i } as CSSProperties}><IntegrationMark src={src} size="lg" /></span>)}</div><div className={styles.route}><i /></div><div className={styles.core}><Grid /></div></>}
    {slide === 1 && <div className={styles.clientGroup}><div><Users size={17} /><span>Client reporting</span></div>{["Advertising accounts", "Commerce sources", "Reporting scope"].map((label, i) => <span key={label} style={{ "--i": i } as CSSProperties}><i />{label}</span>)}</div>}
    {slide === 2 && <div className={styles.fleet}><div className={styles.fleetCore}><Grid /><span>Monstera coordinates</span></div>{["Source setup", "Ongoing checks", "Reporting"].map((label, i) => <div key={label} style={{ "--i": i } as CSSProperties}><ShieldCheck size={16} /><span>{label}</span><i /></div>)}</div>}
    {slide === 3 && <div className={styles.report}><div><IntegrationMark src={INTEGRATION_LOGOS.googleSheets} size="md" /><span>Your report</span><FileText size={17} /></div><div className={styles.reportRows}>{[0,1,2,3].map(i => <span key={i} style={{ "--i": i } as CSSProperties}><i /><i /><i /></span>)}</div><small><Database size={13} />Source → warehouse → destination</small></div>}
  </div>;
}

/** Optional product education. No task execution, progress claims or automatic opening. */
export function FeatureReminder({ open, onClose, hrefFor = path => path, highlights: suppliedHighlights }: { highlights?: readonly FeatureHighlight[]; open: boolean; onClose: () => void; hrefFor?: (path: string) => string }) {
  const highlights = suppliedHighlights?.length ? suppliedHighlights : defaultHighlights;
  const [slide, setSlide] = useState(0), [mounted, setMounted] = useState(false), [rendered, setRendered] = useState(open);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (open) { setRendered(true); setSlide(0); return; }
    const timer = setTimeout(() => setRendered(false), 180);
    return () => clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => dialog.current?.focus(), 0);
    return () => { clearTimeout(timer); document.body.style.overflow = overflow; if (previous instanceof HTMLElement) previous.focus(); };
  }, [open]);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
  }
  if (!mounted || !rendered) return null;
  const current = Math.min(slide, highlights.length - 1);
  const item = highlights[current];
  return createPortal(<div className={`${styles.overlay} ${!open ? styles.closing : ""}`} onClick={onClose}>
    <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="feature-reminder-title" aria-describedby="feature-reminder-copy" tabIndex={-1} onKeyDown={keyboard} onClick={event => event.stopPropagation()} inert={!open}>
      <header><span><LogoMark className="h-5 w-5" />Monstera Cloud</span><button onClick={onClose} aria-label="Close feature reminder"><X size={17} /></button></header>
      <div className={styles.body}>
        <div className={styles.art} key={`art-${slide}`}><Illustration slide={item.artwork} /><span className={styles.artCaption}>A glimpse of what you can do</span></div>
        <section key={`copy-${slide}`} className={styles.copy}>
          <p className={styles.eyebrow}>{item.label}</p><h2 id="feature-reminder-title">{item.title}</h2><p id="feature-reminder-copy">{item.copy}</p>
          <Link href={hrefFor(item.path)} onClick={onClose}>{item.link}<ArrowRight size={14} /></Link>
        </section>
      </div>
      <footer><button className={styles.later} onClick={onClose}>Not now</button><div className={styles.pages} role="group" aria-label="Feature highlights">{highlights.map((item, index) => <button key={item.label} aria-label={`Show ${item.label.toLowerCase()}`} aria-pressed={current === index} onClick={() => setSlide(index)} />)}</div><div className={styles.navigation}><button aria-label="Previous feature" disabled={current === 0} onClick={() => setSlide(current - 1)}><ArrowLeft size={15} /></button><button className={styles.next} onClick={() => current === highlights.length - 1 ? onClose() : setSlide(current + 1)}>{current === highlights.length - 1 ? "Done" : "Next"}{slide !== highlights.length - 1 && <ArrowRight size={14} />}</button></div></footer>
    </div>
  </div>, document.body);
}
