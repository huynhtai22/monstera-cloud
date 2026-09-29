"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const EXIT_DURATION_MS = 380;
const SIGNAL_PATH = "M30 165 C75 162 102 144 130 125 C154 108 177 109 203 92 C226 76 248 63 291 63";

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
  const threadId = `loader-thread-${visualId}`;
  const glintId = `loader-glint-${visualId}`;
  const tailId = `loader-tail-${visualId}`;
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
          <div className={styles.halo} />
          <svg className={styles.artwork} viewBox="0 25 320 170" fill="none">
            <defs>
              <linearGradient id={threadId} x1="27" y1="164" x2="290" y2="63" gradientUnits="userSpaceOnUse">
                <stop stopColor="var(--loader-thread)" stopOpacity="0" />
                <stop offset=".26" stopColor="var(--loader-thread)" stopOpacity=".35" />
                <stop offset=".48" stopColor="var(--loader-thread)" stopOpacity=".84" />
                <stop offset=".7" stopColor="var(--loader-thread)" stopOpacity=".42" />
                <stop offset="1" stopColor="var(--loader-thread)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={glintId} x1="0" y1="-5" x2="7" y2="5" gradientUnits="userSpaceOnUse">
                <stop stopColor="var(--loader-amber-deep)" />
                <stop offset=".5" stopColor="var(--loader-amber)" />
                <stop offset="1" stopColor="var(--loader-amber-light)" />
              </linearGradient>
              <linearGradient id={tailId} x1="-29" y1="0" x2="0" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="var(--loader-amber)" stopOpacity="0" />
                <stop offset=".58" stopColor="var(--loader-amber)" stopOpacity=".22" />
                <stop offset="1" stopColor="var(--loader-amber-light)" stopOpacity=".9" />
              </linearGradient>
            </defs>
            <path className={styles.threadGlow} d={SIGNAL_PATH} stroke={`url(#${threadId})`} />
            <path className={styles.thread} d={SIGNAL_PATH} stroke={`url(#${threadId})`} />
            <path className={styles.echo} d="M67 174 C112 154 122 130 159 118" />
            <path className={styles.echoSoft} d="M184 107 C224 92 235 75 276 71" />
            <g className={styles.signal}>
              <g className={styles.signalBlock}>
                <rect className={styles.tailGlow} x="-32" y="-4" width="32" height="8" rx="4" fill={`url(#${tailId})`} />
                <rect className={styles.tailLine} x="-29" y="-1" width="29" height="2" rx="1" fill={`url(#${tailId})`} />
                <rect x="-4.5" y="-4.5" width="9" height="9" rx="2.3" fill={`url(#${glintId})`} />
                <rect x="-1.6" y="-1.6" width="3.2" height="3.2" rx=".6" fill="var(--loader-amber-light)" opacity=".75" />
                <animateMotion dur="5.4s" repeatCount="indefinite" rotate="auto" path={SIGNAL_PATH} keyPoints="0;.03;.91;1;1" keyTimes="0;.12;.72;.88;1" keySplines=".3 0 .7 1;.35 0 .3 1;.25 0 .65 1;0 0 1 1" calcMode="spline" />
              </g>
              <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;.12;.72;.88;1" dur="5.4s" repeatCount="indefinite" />
            </g>
            <rect className={styles.staticSignal} x="248" y="71" width="9" height="9" rx="2.3" fill="var(--loader-amber)" />
          </svg>
          <div className={styles.emblem}><LogoMark className={styles.mark} /></div>
        </div>
        <p className={styles.brand} aria-hidden="true">Monstera Cloud</p>
        <h1>{title}</h1>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
      </div>
    </div>
  );
}
