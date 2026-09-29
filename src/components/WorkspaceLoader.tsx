"use client";

import { useEffect, useRef, useState } from "react";
import { Database, FileChartColumnIncreasing, PlugZap } from "lucide-react";
import { LogoMark } from "./Logo";
import styles from "./WorkspaceLoader.module.css";

const EXIT_DURATION_MS = 340;

/** Session handoff for the console. The flow is an illustration, not sync progress. */
export function WorkspaceLoader({
  visible,
  minVisibleMs = 300,
}: {
  visible: boolean;
  minVisibleMs?: number;
}) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(visible);
  const shownAt = useRef(visible ? Date.now() : 0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFrame = useRef<number | null>(null);

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    if (showFrame.current !== null) cancelAnimationFrame(showFrame.current);

    if (visible) {
      shownAt.current = Date.now();
      setMounted(true);
      showFrame.current = requestAnimationFrame(() => setShown(true));
    } else if (shownAt.current > 0) {
      const remaining = Math.max(0, minVisibleMs - (Date.now() - shownAt.current));
      hideTimer.current = setTimeout(() => {
        setShown(false);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        unmountTimer.current = setTimeout(() => setMounted(false), reduceMotion ? 0 : EXIT_DURATION_MS);
      }, remaining);
    }

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
      if (showFrame.current !== null) cancelAnimationFrame(showFrame.current);
    };
  }, [visible, minVisibleMs]);

  if (!mounted) return null;

  return (
    <div
      className={styles.overlay}
      data-visible={shown}
      role="status"
      aria-live="polite"
      aria-label="Opening your workspace. Verifying your session."
    >
      <div className={styles.card}>
        <div className={styles.topline}>
          <div className={styles.brand}>
            <LogoMark className={styles.logo} />
            <span>Monstera Cloud</span>
          </div>
          <span className={styles.consoleLabel}>CONSOLE / WORKSPACE</span>
        </div>

        <div className={styles.intro}>
          <span className={styles.eyebrow}><span className={styles.liveDot} /> YOUR WORKSPACE</span>
          <h1>One clear path for your data.</h1>
          <p>Opening your console and checking your session.</p>
        </div>

        <div className={styles.flow} aria-hidden="true">
          <div className={styles.step}>
            <span className={styles.stepNumber}>01 / CONNECT</span>
            <span className={styles.iconWrap}><PlugZap size={22} strokeWidth={1.5} /></span>
            <strong>Sources</strong>
            <span className={styles.stepDetail}>Your channels</span>
          </div>
          <span className={styles.connector} />
          <div className={`${styles.step} ${styles.centerStep}`}>
            <span className={styles.stepNumber}>02 / UNIFY</span>
            <span className={styles.iconWrap}><Database size={22} strokeWidth={1.5} /></span>
            <strong>Warehouse</strong>
            <span className={styles.stepDetail}>One structure</span>
          </div>
          <span className={`${styles.connector} ${styles.secondConnector}`} />
          <div className={styles.step}>
            <span className={styles.stepNumber}>03 / DELIVER</span>
            <span className={styles.iconWrap}><FileChartColumnIncreasing size={22} strokeWidth={1.5} /></span>
            <strong>Reports</strong>
            <span className={styles.stepDetail}>Ready to share</span>
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.footerCopy}>
            <span>Preparing your workspace</span>
            <span>Secure session check</span>
          </div>
          <div className={styles.progressTrack} aria-hidden="true"><span /></div>
        </div>
      </div>
    </div>
  );
}
