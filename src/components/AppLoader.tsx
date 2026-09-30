"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { LogoMark } from "./Logo";
import theme from "./ConsoleTheme.module.css";
import styles from "./AppLoader.module.css";

const SESSION_KEY = "monstera-workspace-intro-seen";
const MOTION = { delay: 200, hold: 600, resolve: 600, exit: 400, backdrop: 120, reduced: 150 };
const paths = ["M18 65C80 65 76 130 124 130", "M59 227C115 227 109 174 141 158", "M306 82C238 82 247 130 196 130", "M284 224C220 224 225 174 178 158"];
const nodes = [[18,65], [59,227], [306,82], [284,224]];
const curves = [[[18,65],[80,65],[76,130],[124,130]], [[59,227],[115,227],[109,174],[141,158]], [[306,82],[238,82],[247,130],[196,130]], [[284,224],[220,224],[225,174],[178,158]]];
const packetFrames = curves.map(points => Array.from({ length: 25 }, (_, i) => {
  const t = i/24, u = 1-t;
  const point = [0,1].map(axis => u*u*u*points[0][axis]+3*u*u*t*points[1][axis]+3*u*t*t*points[2][axis]+t*t*t*points[3][axis]);
  return { offset: t, transform: `translate3d(${point[0]}px, ${point[1]}px, 0)`, opacity: i === 24 ? 0 : i === 0 ? .3 : 1 };
}));
const providerAssets: Record<string,string> = { meta_ads: "meta", facebook: "meta", google_ads: "google-ads", tiktok_business: "tiktok", tiktok_ads: "tiktok", shopee: "shopee", lazada: "lazada", shopify: "shopify" };
const copy = {
  en: ["Verifying session", "Loading workspace", "Checking sources", "Preparing dashboard"],
  vi: ["Đang xác minh phiên đăng nhập", "Đang tải không gian làm việc", "Đang kiểm tra nguồn dữ liệu", "Đang chuẩn bị bảng điều khiển"],
};

/** Server-rendered cover; real completions illuminate the four source connections. */
export function AppLoader({ visible, milestones = [false,false,false,false], measurable = false, providers = null, locale, onChromeReveal, onContentReveal }: {
  visible: boolean;
  milestones?: boolean[];
  measurable?: boolean;
  providers?: string[] | null;
  locale?: "en" | "vi";
  onChromeReveal?: (mode?: "flight" | "fade" | "none") => void;
  onContentReveal?: () => void;
}) {
  const [mounted, setMounted] = useState(true);
  const [phase, setPhase] = useState<"enter" | "resolve" | "exit" | "timeout">("enter");
  const [completed, setCompleted] = useState([false,false,false,false]);
  const [language, setLanguage] = useState<"en" | "vi">("en");
  const showAt = useRef<number | null>(null);
  const skipped = useRef(false);
  const timedOut = useRef(false);
  const [slow, setSlow] = useState(false);
  const tile = useRef<HTMLDivElement>(null);
  const landingTarget = useRef<SVGElement | null>(null);
  const [m0,m1,m2,m3] = milestones;
  useEffect(() => setCompleted(current => current.map((done,i) => done || [m0,m1,m2,m3 && !visible][i])), [m0,m1,m2,m3,visible]);
  useEffect(() => {
    try { const saved = localStorage.getItem("marketing_lang"); setLanguage(saved === "vi" || (!saved && navigator.language.startsWith("vi")) ? "vi" : "en"); }
    catch { setLanguage(navigator.language.startsWith("vi") ? "vi" : "en"); }
  }, []);

  useLayoutEffect(() => {
    if (!mounted || skipped.current) return;
    if (showAt.current === null) {
      const root = document.documentElement;
      const navigation = performance.getEntriesByType("navigation")[0];
      const clientNavigation = navigation && new URL(navigation.name).pathname !== location.pathname;
      let seen = root.dataset.monsteraStartup === "skip";
      try { seen ||= sessionStorage.getItem(SESSION_KEY) === "1"; } catch { /* Optional storage. */ }
      if (seen || clientNavigation || location.pathname.startsWith("/invite/")) {
        skipped.current = true; setMounted(false); onChromeReveal?.(); onContentReveal?.(); return;
      }
      const entrance = tile.current?.getAnimations()[0];
      const start = typeof entrance?.startTime === "number" ? entrance.startTime : Number(root.dataset.monsteraStartupAt ?? performance.now());
      showAt.current = start + MOTION.delay;
    }
    if (!visible && timedOut.current) { setMounted(false); onChromeReveal?.(); onContentReveal?.(); return; }
    const appearance = showAt.current;
    const remember = () => { try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* Optional storage. */ } };
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (visible) {
      timers.push(setTimeout(remember, Math.max(0, appearance - performance.now())));
    } else if (performance.now() < appearance) {
      remember(); setMounted(false); onChromeReveal?.(); onContentReveal?.();
    } else {
      remember();
      timers.push(setTimeout(() => {
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced) {
          setPhase("exit");
          tile.current?.animate([{opacity: 1},{opacity: 0}], {duration: MOTION.reduced, easing: "ease-in-out", fill: "forwards"});
          onChromeReveal?.("fade"); onContentReveal?.();
          timers.push(setTimeout(() => setMounted(false), MOTION.reduced));
          return;
        }
        // Keep all real completions visible for a full packet/glow beat before travel.
        setPhase("resolve");
        timers.push(setTimeout(() => {
          const target = document.querySelector<SVGElement>("[data-workspace-mark] svg");
          const brand = tile.current?.querySelector("svg");
          const from = brand?.getBoundingClientRect();
          const to = target?.getBoundingClientRect();
          const collapsed = target?.closest("aside")?.dataset.collapsed === "true";
          const canFly = innerWidth >= 1024 && !collapsed && from && to && to.left >= 0 && to.right <= innerWidth && to.top >= 0 && to.width > 0;
          if (canFly && tile.current && target) {
            const dx = to.x + to.width/2 - (from.x + from.width/2);
            const dy = to.y + to.height/2 - (from.y + from.height/2);
            document.documentElement.dataset.monsteraTileFlight = "true";
            landingTarget.current = target;
            target.style.visibility = "hidden";
            document.querySelectorAll('[data-workspace-shell] aside[aria-label="Application sidebar"], [data-workspace-shell] nav[aria-label="Breadcrumb"]').forEach((part,index) => part.animate([{opacity:.65},{opacity:1}], {duration:180,delay:index*50,easing:"cubic-bezier(.22,1,.36,1)",fill:"both"}));
            tile.current.animate([
              { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
              { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${to.width/from.width})`, opacity: 1 },
            ], { duration: MOTION.exit, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" });
          } else {
            tile.current?.animate([{ opacity: 1 },{ opacity: 0 }], { duration: 200, easing: "ease-in-out", fill: "forwards" });
          }
          setPhase("exit");
          onChromeReveal?.(canFly ? "flight" : "fade");
          timers.push(setTimeout(() => onContentReveal?.(), canFly ? MOTION.exit * .6 : MOTION.backdrop));
          timers.push(setTimeout(() => {
            delete document.documentElement.dataset.monsteraTileFlight;
            if (landingTarget.current) landingTarget.current.style.visibility = "";
            setMounted(false);
          }, canFly ? MOTION.exit : 200));
        }, MOTION.resolve));
      }, Math.max(0, appearance + MOTION.hold - performance.now())));
    }
    return () => { timers.forEach(clearTimeout); delete document.documentElement.dataset.monsteraTileFlight;
            if (landingTarget.current) landingTarget.current.style.visibility = ""; };
  }, [visible, mounted, onChromeReveal, onContentReveal]);

  useEffect(() => {
    if (!mounted || !visible || skipped.current) return;
    const start = (showAt.current ?? performance.now()) - MOTION.delay;
    const slowTimer = setTimeout(() => setSlow(true), Math.max(0, start + 4000 - performance.now()));
    const timeoutTimer = setTimeout(() => { timedOut.current = true; setPhase("timeout"); onChromeReveal?.(); onContentReveal?.(); }, Math.max(0, start + 10000 - performance.now()));
    return () => { clearTimeout(slowTimer); clearTimeout(timeoutTimer); };
  }, [mounted, visible, onChromeReveal, onContentReveal]);

  if (!mounted) return null;
  const lang = locale ?? language;
  if (phase === "timeout") return <div className={`${theme.root} ${styles.timeoutNotice}`} data-console-theme="dark" role="status" lang={lang}>
    <p>{lang === "vi" ? "Đang xử lý lâu hơn dự kiến. Bạn có thể thử lại." : "This is taking longer than expected. You can retry."}</p>
    <button onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Optional storage. */ } location.reload(); }}>{lang === "vi" ? "Thử lại" : "Retry"}</button>
  </div>;
  const pendingStep = completed.findIndex(done => !done);
  const step = pendingStep === -1 ? 3 : pendingStep;
  const resolved = completed.every(Boolean) && !visible;
  const status = resolved ? (lang === "vi" ? "Không gian làm việc đã sẵn sàng" : "Workspace ready") : slow && visible ? (lang === "vi" ? "Vẫn đang xử lý..." : "Still working...") : measurable ? copy[lang][step] : (lang === "vi" ? "Đang chuẩn bị không gian làm việc" : "Preparing your workspace");
  // Each node owns one startup signal; provider icons never imply live credential checks.
  const slots = [0,1,2,3];
  return <div className={`${theme.root} ${styles.overlay}`} data-console-theme="dark" data-phase={phase} data-pending={visible} data-workspace-loader role="status" aria-live="polite" aria-label={status} lang={lang}>
    <div className={styles.backdrop} />
    <div className={styles.visual} data-loader-visual>
      <div className={styles.scene} aria-hidden="true">
        <div hidden>{completed.map((done,i) => <span key={i} data-milestone={i+1} data-complete={done}/>)}</div>
        <svg className={styles.connections} viewBox="0 0 320 260">
          {slots.map((slot,i) => <g key={slot} style={{ animationDelay: `${200+i*50}ms`, "--resolve-delay": `${i*60}ms` } as CSSProperties}>
            <path d={paths[slot]} pathLength="1" className={styles.track}/>
          </g>)}
        </svg>
        {slots.map((slot,i) => {
          const done = completed[i];
          const active = i === pendingStep;
          const asset = providers?.[i] ? providerAssets[providers[i]] : undefined;
          return <div key={slot} className={styles.branch} data-source-node data-signal={i+1} data-state={done ? "done" : active ? "active" : "pending"} data-provider={providers?.[i]}>
            <div className={styles.nodeShell} style={{ left: nodes[slot][0], top: nodes[slot][1], animationDelay: `${200+i*50}ms` }}>
              <span className={styles.nodePulse}/><span className={styles.nodeFace}>{asset && <i className={styles.sourceGlyph} style={{ maskImage: `url(/logos/${asset}.svg)` }}/>}</span>
            </div>
            {active && phase === "enter" && <Packet line={slot} loop />}
            {phase === "resolve" && <Packet line={slot} duration={300} delay={i*60} />}
            {done && <Packet key={`done-${i}`} line={slot} />}
          </div>;
        })}
        <div ref={tile} className={styles.emblem} data-loader-tile><div className={styles.face}><LogoMark className={styles.mark}/><i className={styles.innerGradient}/><i className={styles.topHighlight}/><svg className={styles.outline} viewBox="0 0 32 32"><rect x="1.5" y="1.5" width="29" height="29" rx="6.5" pathLength="1" /></svg></div>
          {completed.map((done,m) => done && <i key={m} className={styles.completionGlow} style={{ animationDelay: `${m*30}ms` }}/>)}
        </div>
      </div>
      <div className={styles.copy}>
        <p className={styles.wordmark} aria-hidden="true">Monstera Cloud</p>
        <div key={`${step}:${status}`} className={styles.step} aria-hidden="true" data-loader-step={resolved ? "ready" : step+1}>
          <p className={styles.eyebrow}>{resolved ? (lang === "vi" ? "SẴN SÀNG" : "READY") : `${lang === "vi" ? "BƯỚC" : "STEP"} ${step+1} / 4`}</p>
          <p className={styles.status}>{status}</p>
        </div>
      </div>
    </div>
  </div>;
}

function Packet({ line, loop = false, duration, delay = 0 }: { line: number; loop?: boolean; duration?: number; delay?: number }) {
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!element.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Static keyframes: the compositor moves this dot, with no per-frame JS or path reads.
    element.current.style.animation = "none";
    const motion = element.current.animate(packetFrames[line], { duration: duration ?? (loop ? 1600 : 450), delay, iterations: loop ? Infinity : 1, easing: "ease-in-out", fill: "both" });
    return () => motion.cancel();
  }, [line, loop, duration, delay]);
  return <span ref={element} className={styles.packet} data-line={line} data-loop={loop} />;
}
