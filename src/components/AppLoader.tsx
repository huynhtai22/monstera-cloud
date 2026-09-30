"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import theme from "./ConsoleTheme.module.css";
import styles from "./AppLoader.module.css";

const SESSION_KEY = "monstera-workspace-intro-seen";
const MOTION = { delay: 200, hold: 600, exit: 480, backdrop: 160, reduced: 150 };
const paths = ["M18 65C80 65 76 130 124 130", "M59 227C115 227 109 174 141 158", "M306 82C238 82 247 130 196 130", "M284 224C220 224 225 174 178 158"];
const nodes = [[18,65], [59,227], [306,82], [284,224]];
const copy = {
  en: ["Verifying your session", "Loading your workspace", "Receiving source health", "Preparing dashboard data", "Your workspace is ready"],
  vi: ["Đang xác minh phiên đăng nhập", "Đang tải không gian làm việc", "Đang nhận trạng thái nguồn dữ liệu", "Đang chuẩn bị dữ liệu tổng quan", "Không gian làm việc đã sẵn sàng"],
};

/** Server-rendered cover; real completions illuminate the four source connections. */
export function AppLoader({ visible, milestones = [false,false,false,false], measurable = false, locale, onExitStart }: {
  visible: boolean;
  milestones?: boolean[];
  measurable?: boolean;
  locale?: "en" | "vi";
  onExitStart?: (animate?: boolean) => void;
}) {
  const [mounted, setMounted] = useState(true);
  const [phase, setPhase] = useState<"enter" | "exit">("enter");
  const [completed, setCompleted] = useState([false,false,false,false]);
  const [language, setLanguage] = useState<"en" | "vi">("en");
  const showAt = useRef<number | null>(null);
  const skipped = useRef(false);
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

  if (!mounted) return null;
  const lang = locale ?? language;
  const pendingStep = completed.findIndex(done => !done);
  const step = pendingStep === -1 ? 4 : pendingStep;
  const status = measurable ? copy[lang][step] : (lang === "vi" ? "Đang chuẩn bị không gian làm việc" : "Preparing your workspace");
  return <div className={`${theme.root} ${styles.overlay}`} data-console-theme="dark" data-phase={phase} data-workspace-loader role="status" aria-live="polite" aria-label={status} lang={lang}>
    <div className={styles.backdrop} />
    <div className={styles.visual} data-loader-visual>
      <div className={styles.scene} aria-hidden="true">
        <svg className={styles.connections} viewBox="0 0 320 260">
          {paths.map((d,i) => <g key={d} style={{ animationDelay: `${200+i*50}ms` }} data-milestone={i+1} data-complete={completed[i]}>
            <path d={d} className={styles.track}/><path d={d} className={styles.signal}/>
            <circle cx={nodes[i][0]} cy={nodes[i][1]} r="13" className={styles.node}/>
          </g>)}
        </svg>
        <div ref={tile} className={styles.emblem}><div className={styles.face}><LogoMark className={styles.mark}/><i className={styles.innerGradient}/><i className={styles.topHighlight}/><svg className={styles.outline} viewBox="0 0 32 32"><rect x="1.5" y="1.5" width="29" height="29" rx="6.5" pathLength="1" /></svg></div></div>
      </div>
      <div className={styles.copy}>
        <p className={styles.wordmark} aria-hidden="true">Monstera Cloud</p>
        <p className={styles.eyebrow} aria-hidden="true">{lang === "vi" ? "BƯỚC" : "STEP"} {Math.min(step+1,4)} / 4</p>
        <div className={styles.status} aria-hidden="true"><StepText text={status} /></div>
      </div>
    </div>
  </div>;
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
