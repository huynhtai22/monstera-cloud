"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const EXIT_DURATION_MS = 340;
const SIGNAL_PATH = "M14 151 C75 160 91 45 175 55 C244 63 263 164 329 151 C380 141 402 91 430 45";
const COUNTER_PATH = "M30 184 C93 160 103 102 149 112 C213 126 230 45 294 40 C356 35 374 103 423 96";
const INNER_PATH = "M35 125 C97 111 109 28 179 35 C263 43 268 139 323 132 C381 124 389 81 414 67";
const OUTER_PATH = "M23 174 C72 198 127 172 159 139 C217 78 261 53 307 68 C362 85 367 142 427 122";

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
      <span className={styles.atmosphere} aria-hidden="true" />
      <span className={styles.stars} aria-hidden="true" />
      <div className={styles.content}>
        <div className={styles.motion} aria-hidden="true">
          <div className={styles.ribbonGlow} />
          <svg className={styles.ribbon} viewBox="0 0 440 220" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id={`loader-ribbon-${visualId}`} x1="0" x2="1" y1="0" y2="0">
                <stop className={styles.ribbonStart} offset="0%" />
                <stop className={styles.ribbonMint} offset="35%" />
                <stop className={styles.ribbonCool} offset="65%" />
                <stop className={styles.ribbonStart} offset="100%" />
              </linearGradient>
              <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <path className={styles.ribbonHalo} d={SIGNAL_PATH} />
            <path className={styles.ribbonHalo} d={COUNTER_PATH} />
            <path className={styles.ribbonFar} d={OUTER_PATH} />
            <path className={styles.ribbonFar} d={INNER_PATH} />
            <path className={styles.ribbonEdge} d={SIGNAL_PATH} />
            <path className={styles.ribbonEdge} d={COUNTER_PATH} />
            <path className={styles.ribbonTrace} d={SIGNAL_PATH} stroke={`url(#loader-ribbon-${visualId})`} />
            <path className={styles.ribbonTrace} d={COUNTER_PATH} stroke={`url(#loader-ribbon-${visualId})`} />
            <circle className={styles.threadStar} cx="113" cy="84" r="2" />
            <circle className={styles.threadStar} cx="291" cy="40" r="1.5" />
            <circle className={styles.threadStar} cx="370" cy="133" r="1.7" />
            <rect className={styles.staticSignal} x="100" y="77" width="20" height="20" rx="5" fill="#edb867" />
            <g className={styles.motionSignal} filter={`url(#${glowId})`}>
              <rect x="-10" y="-10" width="20" height="20" rx="5" fill="#eebd77" />
              <rect x="-3" y="-3" width="6" height="6" rx="1.5" fill="#fff2d5" opacity=".72" />
              <animateMotion dur="5.2s" repeatCount="indefinite" rotate="auto" path={SIGNAL_PATH} />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.9;1" dur="5.2s" repeatCount="indefinite" />
            </g>
            <circle className={styles.mintSignal} r="2.7" fill="#c5f5e0" filter={`url(#${glowId})`}>
              <animateMotion dur="8.4s" repeatCount="indefinite" path={COUNTER_PATH} />
            </circle>
          </svg>
          <span className={styles.brandCore}><LogoMark className={styles.mark} /></span>
        </div>
        <p className={styles.wordmark} aria-hidden="true"><span />MONSTERA CLOUD</p>
        <h1>{title}</h1>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
      </div>
    </div>
  );
}
