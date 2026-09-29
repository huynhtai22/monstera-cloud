"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const EXIT_DURATION_MS = 340;
const SIGNAL_PATH = "M18 110 C76 12 150 12 220 110 S360 208 422 110";
const COUNTER_PATH = "M18 110 C76 208 150 208 220 110 S360 12 422 110";
const INNER_PATH = "M24 113 C91 40 158 34 220 110 S342 183 416 103";
const OUTER_PATH = "M24 107 C91 180 158 186 220 110 S342 37 416 117";

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
            <circle className={styles.threadStar} cx="98" cy="50" r="2" />
            <circle className={styles.threadStar} cx="344" cy="47" r="1.5" />
            <circle className={styles.threadStar} cx="347" cy="169" r="1.7" />
            <rect className={styles.staticSignal} x="110" y="30" width="20" height="20" rx="5" fill="#edb867" />
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
