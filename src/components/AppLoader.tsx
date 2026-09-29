"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const EXIT_DURATION_MS = 340;
const SIGNAL_PATH = "M0 145 C34 138 43 116 74 124 S113 137 145 112 S184 123 216 101 S254 117 288 90 S327 104 360 78 S399 90 432 65 S471 87 504 58 S543 70 576 45 S615 69 648 36 S690 47 720 19";

/** Reusable console loading screen; the animation never represents task progress. */
export function AppLoader({
  visible,
  title = "Loading",
  detail = "",
  minVisibleMs = 300,
}: {
  visible: boolean;
  title?: string;
  detail?: string;
  minVisibleMs?: number;
}) {
  const visualId = useId().replace(/:/g, "");
  const gradientId = `loader-chart-fill-${visualId}`;
  const glowId = `loader-amber-glow-${visualId}`;
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
    <div className={styles.overlay} data-visible={shown} role="status" aria-live="polite" aria-label={detail ? `${title}. ${detail}.` : title}>
      <span className={styles.atmosphere} aria-hidden="true" />
      <div className={styles.content}>
        <div className={styles.motion} aria-hidden="true">
          <div className={styles.chartCard}>
            <div className={styles.chartToolbar}>
              <div className={styles.chartIdentity}><LogoMark className={styles.chartMark} /><span className={styles.toolbarLine} /></div>
              <div className={styles.toolbarControls}><span /><span /><span /></div>
            </div>
            <div className={styles.chartSurface}>
              <svg className={styles.chart} viewBox="0 0 720 180" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#8ce5bc" stopOpacity=".24" />
                    <stop offset="100%" stopColor="#8ce5bc" stopOpacity="0" />
                  </linearGradient>
                  <filter id={glowId} x="-150%" y="-150%" width="400%" height="400%">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                <path className={styles.chartFill} d={`${SIGNAL_PATH} V180 H0Z`} fill={`url(#${gradientId})`} />
                <path className={styles.chartLine} d={SIGNAL_PATH} />
                <circle cx="720" cy="19" r="4.5" fill="#b4f2d3" />
                <rect className={styles.motionSignal} x="-10" y="-10" width="20" height="20" rx="5" fill="#edb867" filter={`url(#${glowId})`}>
                  <animateMotion dur="4.8s" repeatCount="indefinite" rotate="auto" path={SIGNAL_PATH} />
                </rect>
                <rect className={styles.staticSignal} x="350" y="68" width="20" height="20" rx="5" fill="#edb867" />
              </svg>
            </div>
            <div className={styles.chartFooter} aria-hidden="true"><span /><span /><span /><span /><span /></div>
          </div>
        </div>
        <p className={styles.wordmark} aria-hidden="true"><span />MONSTERA CLOUD</p>
        <h1>{title}</h1>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
      </div>
    </div>
  );
}
