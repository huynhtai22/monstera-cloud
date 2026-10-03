"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Database, DatabaseZap, FileText, ShieldCheck, ShoppingBag, Users, X } from "lucide-react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { LogoMark } from "@/components/Logo";
import styles from "./FeatureReminder.module.css";

import { defaultHighlights, type FeatureHighlight } from "@/lib/console-feature-campaigns";
export type { FeatureHighlight } from "@/lib/console-feature-campaigns";

const CLOSE_DURATION_MS = 280;
const SCENE_EXIT_MS = 200;

function Grid() {
  return <span className={styles.grid}>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</span>;
}

function Illustration({ slide }: { slide: number }) {
  return <div className={styles.illustration} aria-hidden="true" data-reminder-art={slide}>
    {slide === 0 && <><svg className={styles.connections} viewBox="0 0 390 300" preserveAspectRatio="none"><path d="M96 60 Q96 142 195 142" /><path d="M290 80 Q290 142 195 142" /><path d="M80 225 Q80 142 195 142" /><path d="M297 245 Q297 142 195 142" /><path d="M200 270 L195 142" /></svg><div className={styles.floatingTools}>{[INTEGRATION_LOGOS.meta, INTEGRATION_LOGOS.googleAds, INTEGRATION_LOGOS.shopee, INTEGRATION_LOGOS.tiktok, INTEGRATION_LOGOS.googleSheets].map((src, i) => <span key={src} style={{ "--i": i } as CSSProperties}><IntegrationMark src={src} size="lg" /></span>)}</div><div className={styles.toolHub}><Grid /><span>Your tools, together</span><ArrowRight size={15} /></div></>}
    {slide === 1 && <div className={styles.clientGroup}><div><Users size={17} /><span>Client reporting</span></div>{[{ label: "Advertising accounts", Icon: DatabaseZap }, { label: "Commerce sources", Icon: ShoppingBag }, { label: "Reporting scope", Icon: Users }].map(({label, Icon}, i) => <span key={label} style={{ "--i": i } as CSSProperties}><Icon size={13} />{label}</span>)}</div>}
    {slide === 2 && <div className={styles.fleet}><div className={styles.fleetCore}><Grid /><span>Monstera coordinates</span></div>{[{ label: "Source setup", Icon: DatabaseZap }, { label: "Ongoing checks", Icon: ShieldCheck }, { label: "Reporting", Icon: FileText }].map(({label, Icon}, i) => <div key={label} style={{ "--i": i } as CSSProperties}><Icon size={16} /><span>{label}</span><i /></div>)}</div>}
    {slide === 3 && <div className={styles.report}><div><IntegrationMark src={INTEGRATION_LOGOS.googleSheets} size="md" /><span>Your report</span><FileText size={17} /></div><div className={styles.reportRows}>{[0,1,2,3].map(i => <span key={i} style={{ "--i": i } as CSSProperties}><i /><i /><i /></span>)}</div><small><Database size={13} />Source → warehouse → destination</small></div>}
  </div>;
}

/** Optional product education. No task execution, progress claims or automatic opening. */
export function FeatureReminder({ open, onClose, hrefFor = path => path, highlights: suppliedHighlights }: { highlights?: readonly FeatureHighlight[]; open: boolean; onClose: () => void; hrefFor?: (path: string) => string }) {
  const highlights = suppliedHighlights?.length ? suppliedHighlights : defaultHighlights;
  const [slide, setSlide] = useState(0), [mounted, setMounted] = useState(false), [rendered, setRendered] = useState(open);
  const dialog = useRef<HTMLDivElement>(null);
  const transition = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [departing, setDeparting] = useState(false);
  useEffect(() => () => { if (transition.current) clearTimeout(transition.current); }, []);
  function changeSlide(next: number) {
    if (transition.current || next === slide) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setSlide(next); return; }
    setDeparting(true);
    transition.current = setTimeout(() => { setSlide(next); setDeparting(false); transition.current = null; }, SCENE_EXIT_MS);
  }
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (transition.current) { clearTimeout(transition.current); transition.current = null; }
    setDeparting(false);
    if (open) { setRendered(true); setSlide(0); return; }
    const timer = setTimeout(() => setRendered(false), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : CLOSE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!rendered) return;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => dialog.current?.focus(), 0);
    return () => { clearTimeout(timer); document.body.style.overflow = overflow; if (previous instanceof HTMLElement) previous.focus(); };
  }, [rendered]);
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
  return createPortal(<div className={`${styles.overlay} ${!open ? styles.closing : ""}`} onClick={onClose} style={{ "--reminder-close-duration": `${CLOSE_DURATION_MS}ms`, "--reminder-scene-exit": `${SCENE_EXIT_MS}ms` } as CSSProperties}>
    <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="feature-reminder-title" aria-describedby="feature-reminder-copy" tabIndex={-1} onKeyDown={keyboard} onClick={event => event.stopPropagation()} inert={!open}>
      <header><span><LogoMark className="h-5 w-5" />Monstera Cloud</span><button onClick={onClose} aria-label="Close feature reminder"><X size={17} /></button></header>
      <div className={`${styles.body} ${departing ? styles.departing : ""}`}>
        <div className={styles.art} key={`art-${slide}`}><Illustration slide={item.artwork} /><span className={styles.artCaption}>Built around your reporting</span></div>
        <section key={`copy-${slide}`} className={styles.copy}>
          <p className={styles.eyebrow}>{item.label}</p><h2 id="feature-reminder-title">{item.title}</h2><p id="feature-reminder-copy">{item.copy}</p>
          <Link href={hrefFor(item.path)} onClick={onClose}>{item.link}<ArrowRight size={14} /></Link>
        </section>
      </div>
      <footer><button className={styles.later} onClick={onClose}>Not now</button><div className={styles.pages} role="group" aria-label="Feature highlights">{highlights.map((item, index) => <button key={item.label} aria-label={`Show ${item.label.toLowerCase()}`} aria-pressed={current === index} onClick={() => changeSlide(index)} />)}</div><div className={styles.navigation}><button aria-label="Previous feature" disabled={current === 0} onClick={() => changeSlide(current - 1)}><ArrowLeft size={15} /></button><button className={styles.next} onClick={() => current === highlights.length - 1 ? onClose() : changeSlide(current + 1)}>{current === highlights.length - 1 ? "Done" : "Next"}{slide !== highlights.length - 1 && <ArrowRight size={14} />}</button></div></footer>
    </div>
  </div>, document.body);
}
