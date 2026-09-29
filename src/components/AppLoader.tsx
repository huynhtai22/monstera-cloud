"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const EXIT_DURATION_MS = 340;
const SIGNAL_PATH = "M72 143 C29 133 18 110 39 83 C72 40 170 12 229 24 C291 37 264 83 217 112 C166 144 113 153 72 143 Z";
const ECHO_PATH = "M26 124 C9 93 64 43 130 22 C155 14 177 11 198 12";

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
      <div className={styles.content}>
        <div className={styles.scene} aria-hidden="true">
          <svg className={styles.orbit} viewBox="0 0 300 170" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id={`loader-orbit-${visualId}`} x1="0" x2="1" y1="1" y2="0">
                <stop offset="0%" stopColor="var(--loader-mint)" stopOpacity=".12" />
                <stop offset="42%" stopColor="var(--loader-mint)" stopOpacity=".35" />
                <stop offset="78%" stopColor="var(--loader-mint)" stopOpacity=".8" />
                <stop offset="100%" stopColor="var(--loader-mint)" stopOpacity=".18" />
              </linearGradient>
              <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <path className={styles.orbitHalo} d={SIGNAL_PATH} />
            <path className={styles.orbitEcho} d={ECHO_PATH} stroke={`url(#loader-orbit-${visualId})`} />
            <path className={styles.orbitLine} d={SIGNAL_PATH} stroke={`url(#loader-orbit-${visualId})`} />
            <path className={styles.signalTrail} d={SIGNAL_PATH} pathLength="100" strokeDasharray="7 93" strokeDashoffset="7">
              <animate attributeName="stroke-dashoffset" from="7" to="-93" dur="5.8s" repeatCount="indefinite" />
            </path>
            <circle className={styles.orbitStar} cx="237" cy="18" r="1" />
            <circle className={styles.distantStar} cx="55" cy="161" r=".9" />
            <circle className={styles.distantStar} cx="256" cy="125" r=".7" />
            <rect className={styles.staticSignal} x="224" y="19" width="10" height="10" rx="2.8" fill="var(--loader-amber)" />
            <g className={styles.motionSignal} filter={`url(#${glowId})`}>
              <rect x="-5" y="-5" width="10" height="10" rx="2.8" fill="var(--loader-amber)" />
              <rect x="-1.4" y="-1.4" width="2.8" height="2.8" rx=".8" fill="#fff2d5" opacity=".78" />
              <animateMotion dur="5.8s" repeatCount="indefinite" rotate="auto" path={SIGNAL_PATH} />
            </g>
          </svg>
          <span className={styles.core}><LogoMark className={styles.mark} /></span>
        </div>
        <p className={styles.brand} aria-hidden="true">Monstera Cloud</p>
        <h1>{title}</h1>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
      </div>
    </div>
  );
}
