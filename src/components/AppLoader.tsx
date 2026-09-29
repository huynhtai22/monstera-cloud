"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const EXIT_DURATION_MS = 340;
const SIGNAL_PATH = "M-20 324 C170 292 298 117 505 83 C696 52 814 151 965 24";
const ECHO_PATH = "M-30 350 C160 309 315 137 505 105 C695 75 831 169 986 60";

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
      <span className={styles.stars} aria-hidden="true" />
      <div className={styles.scene}>
        <svg className={styles.orbit} viewBox="0 0 960 380" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <linearGradient id={`loader-orbit-${visualId}`} x1="0" x2="1" y1="1" y2="0">
              <stop offset="0%" stopColor="var(--loader-mint)" stopOpacity="0" />
              <stop offset="38%" stopColor="var(--loader-mint)" stopOpacity=".62" />
              <stop offset="65%" stopColor="var(--loader-mint)" stopOpacity=".42" />
              <stop offset="100%" stopColor="var(--loader-mint)" stopOpacity="0" />
            </linearGradient>
            <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path className={styles.orbitHalo} d={SIGNAL_PATH} />
          <path className={styles.orbitEcho} d={ECHO_PATH} stroke={`url(#loader-orbit-${visualId})`} />
          <path className={styles.orbitLine} d={SIGNAL_PATH} stroke={`url(#loader-orbit-${visualId})`} />
          <circle className={styles.orbitStar} cx="305" cy="169" r="1.5" />
          <circle className={styles.orbitStar} cx="684" cy="76" r="1" />
          <rect className={styles.staticSignal} x="497" y="75" width="16" height="16" rx="4" fill="#edb867" />
          <g className={styles.motionSignal} filter={`url(#${glowId})`}>
            <rect x="-8" y="-8" width="16" height="16" rx="4" fill="#eebd77" />
            <rect x="-2" y="-2" width="4" height="4" rx="1" fill="#fff2d5" opacity=".7" />
            <animateMotion dur="6.4s" repeatCount="indefinite" rotate="auto" path={SIGNAL_PATH} />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="6.4s" repeatCount="indefinite" />
          </g>
        </svg>
        <div className={styles.content}>
          <div className={styles.brand} aria-hidden="true">
            <LogoMark className={styles.mark} />
            <span>Monstera Cloud</span>
          </div>
          <h1>{title}</h1>
          {detail ? <p className={styles.detail}>{detail}</p> : null}
        </div>
      </div>
    </div>
  );
}
