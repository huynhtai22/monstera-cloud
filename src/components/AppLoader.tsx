"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import theme from "./ConsoleTheme.module.css";
import styles from "./AppLoader.module.css";

const SESSION_KEY = "monstera-workspace-intro-seen";
const MOTION = { delay: 200, hold: 600, exit: 480, backdrop: 160, reduced: 150 };
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
export function AppLoader({ visible, milestones = [false,false,false,false], measurable = false, providers = null, locale, onExitStart }: {
  visible: boolean;
  milestones?: boolean[];
  measurable?: boolean;
  providers?: string[] | null;
  locale?: "en" | "vi";
  onExitStart?: (animate?: boolean) => void;
}) {
  const [mounted, setMounted] = useState(true);
  const [phase, setPhase] = useState<"enter" | "exit" | "timeout">("enter");
  const [completed, setCompleted] = useState([false,false,false,false]);
  const [language, setLanguage] = useState<"en" | "vi">("en");
  const showAt = useRef<number | null>(null);
  const skipped = useRef(false);
  const timedOut = useRef(false);
  const [slow, setSlow] = useState(false);
  const tile = useRef<HTMLDivElement>(null);
  const [m0,m1,m2,m3] = milestones;
  useEffect(() => setCompleted(current => current.map((done,i) => done || [m0,m1,m2,m3][i])), [m0,m1,m2,m3]);
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
        skipped.current = true; setMounted(false); onExitStart?.(); return;
      }
      const entrance = tile.current?.getAnimations()[0];
      const start = typeof entrance?.startTime === "number" ? entrance.startTime : Number(root.dataset.monsteraStartupAt ?? performance.now());
      showAt.current = start + MOTION.delay;
    }
    if (!visible && timedOut.current) { setMounted(false); onExitStart?.(); return; }
    const appearance = showAt.current;
    const remember = () => { try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* Optional storage. */ } };
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (visible) {
      timers.push(setTimeout(remember, Math.max(0, appearance - performance.now())));
    } else if (performance.now() < appearance) {
      remember(); setMounted(false); onExitStart?.();
    } else {
      remember();
      timers.push(setTimeout(() => {
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const target = document.querySelector<SVGElement>("[data-workspace-mark] svg");
        const from = tile.current?.getBoundingClientRect();
        const to = target?.getBoundingClientRect();
        const canFly = !reduced && from && to && to.left >= 0 && to.right <= innerWidth && to.top >= 0 && to.width > 0;
        if (canFly && tile.current) {
          const dx = to.x + to.width/2 - (from.x + from.width/2);
          const dy = to.y + to.height/2 - (from.y + from.height/2);
          document.documentElement.dataset.monsteraTileFlight = "true";
          tile.current.animate([
            { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${to.width/from.width})`, opacity: 1 },
          ], { duration: MOTION.exit, easing: "ease-in-out", fill: "forwards" });
        } else {
          tile.current?.animate([{ opacity: 1 },{ opacity: 0 }], { duration: reduced ? MOTION.reduced : MOTION.backdrop, easing: "ease-in-out", fill: "forwards" });
        }
        setPhase("exit");
        onExitStart?.(true);
        // Copy and source motif disappear before the destination starts revealing.
        timers.push(setTimeout(() => {
          delete document.documentElement.dataset.monsteraTileFlight;
          setMounted(false);
        }, reduced ? MOTION.reduced : MOTION.exit));
      }, Math.max(0, appearance + MOTION.hold - performance.now())));
    }
    return () => { timers.forEach(clearTimeout); delete document.documentElement.dataset.monsteraTileFlight; };
  }, [visible, mounted, onExitStart]);

  useEffect(() => {
    if (!mounted || !visible || skipped.current) return;
    const start = (showAt.current ?? performance.now()) - MOTION.delay;
    const slowTimer = setTimeout(() => setSlow(true), Math.max(0, start + 4000 - performance.now()));
    const timeoutTimer = setTimeout(() => { timedOut.current = true; setPhase("timeout"); onExitStart?.(); }, Math.max(0, start + 10000 - performance.now()));
    return () => { clearTimeout(slowTimer); clearTimeout(timeoutTimer); };
  }, [mounted, visible, onExitStart]);

  if (!mounted) return null;
  const lang = locale ?? language;
  if (phase === "timeout") return <div className={`${theme.root} ${styles.timeoutNotice}`} data-console-theme="dark" role="status" lang={lang}>
    <p>{lang === "vi" ? "Đang xử lý lâu hơn dự kiến. Bạn có thể thử lại." : "This is taking longer than expected. You can retry."}</p>
    <button onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Optional storage. */ } location.reload(); }}>{lang === "vi" ? "Thử lại" : "Retry"}</button>
  </div>;
  const pendingStep = completed.findIndex(done => !done);
  const step = pendingStep === -1 ? 3 : pendingStep;
  const status = slow && visible ? (lang === "vi" ? "Vẫn đang xử lý…" : "Still working…") : measurable ? copy[lang][step] : (lang === "vi" ? "Đang chuẩn bị không gian làm việc" : "Preparing your workspace");
  const count = providers?.length ? Math.max(2, Math.min(4, providers.length)) : 4;
  const slots = count === 2 ? [0,3] : count === 3 ? [0,1,2] : [0,1,2,3];
  return <div className={`${theme.root} ${styles.overlay}`} data-console-theme="dark" data-phase={phase} data-workspace-loader role="status" aria-live="polite" aria-label={status} lang={lang}>
    <div className={styles.backdrop} />
    <div className={styles.visual} data-loader-visual>
      <div className={styles.scene} aria-hidden="true">
        <div hidden>{completed.map((done,i) => <span key={i} data-milestone={i+1} data-complete={done}/>)}</div>
        <svg className={styles.connections} viewBox="0 0 320 260">
          {slots.map((slot,i) => <g key={slot} style={{ animationDelay: `${200+i*50}ms` }}>
            <path d={paths[slot]} pathLength="1" className={styles.track}/>
          </g>)}
        </svg>
        {slots.map((slot,i) => {
          const assigned = [0,1,2,3].filter(m => Math.floor(m*count/4) === i);
          const done = assigned.every(m => completed[m]);
          const active = assigned.includes(pendingStep);
          const asset = providers?.[i] ? providerAssets[providers[i]] : undefined;
          return <div key={slot} className={styles.branch} data-source-node data-state={done ? "done" : active ? "active" : "pending"} data-provider={providers?.[i]}>
            <div className={styles.nodeShell} style={{ left: nodes[slot][0], top: nodes[slot][1], animationDelay: `${200+i*50}ms` }}>
              <span className={styles.nodePulse}/><span className={styles.nodeFace}>{asset && <i className={styles.sourceGlyph} style={{ maskImage: `url(/logos/${asset}.svg)` }}/>}</span>
            </div>
            {active && <Packet line={slot} loop />}
            {assigned.filter(m => completed[m]).map(m => <Packet key={`done-${m}`} line={slot} />)}
          </div>;
        })}
        <div ref={tile} className={styles.emblem} data-loader-tile><div className={styles.face}><LogoMark className={styles.mark}/><i className={styles.innerGradient}/><i className={styles.topHighlight}/><svg className={styles.outline} viewBox="0 0 32 32"><rect x="1.5" y="1.5" width="29" height="29" rx="6.5" pathLength="1" /></svg></div>
          {completed.map((done,m) => done && <i key={m} className={styles.completionGlow} style={{ animationDelay: `${m*30}ms` }}/>)}
        </div>
      </div>
      <div className={styles.copy}>
        <p className={styles.wordmark} aria-hidden="true">Monstera Cloud</p>
        <p className={styles.eyebrow} aria-hidden="true">{lang === "vi" ? "BƯỚC" : "STEP"} {step+1} / 4</p>
        <div className={styles.status} aria-hidden="true"><StepText text={status} /></div>
      </div>
    </div>
  </div>;
}

function Packet({ line, loop = false }: { line: number; loop?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!element.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Static keyframes: the compositor moves this dot, with no per-frame JS or path reads.
    element.current.style.animation = "none";
    const motion = element.current.animate(packetFrames[line], { duration: loop ? 1600 : 450, iterations: loop ? Infinity : 1, easing: "ease-in-out", fill: "both" });
    return () => motion.cancel();
  }, [line, loop]);
  return <span ref={element} className={styles.packet} data-line={line} data-loop={loop} />;
}

function StepText({ text }: { text: string }) {
  const [previous, setPrevious] = useState<string | null>(null);
  const last = useRef(text);
  useEffect(() => {
    if (last.current === text) return;
    setPrevious(last.current);
    last.current = text;
    const timer = setTimeout(() => setPrevious(null), 250);
    return () => clearTimeout(timer);
  }, [text]);
  return <>{previous && <span className={styles.outgoing}>{previous}</span>}<span key={text}>{text}</span></>;
}
