"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const EXIT_DURATION_MS = 340;
// Uneven contours give the light a sculpted silhouette without a mirrored loop.
function contourPath(layer: number, reverse = false) {
  const points = Array.from({ length: 121 }, (_, step) => {
    const index = reverse ? 120 - step : step;
    const angle = (-133 + index * 2.7) * Math.PI / 180;
    const taper = Math.pow(Math.sin(index / 120 * Math.PI), .85);
    const spread = layer * (3 + 5 * Math.pow(Math.sin(angle * .5 + .6), 2)) * taper;
    const radius = 79 + 9 * Math.sin(angle + .8) + 5 * Math.sin(2 * angle - .5) + spread;
    const x = 160 + Math.cos(angle) * radius * 1.08;
    const y = 135 + Math.sin(angle) * radius * .87;
    return `${step === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return points.join(" ");
}

const CONTOURS = Array.from({ length: 11 }, (_, index) => contourPath(index * .35));
const SHELL_SURFACE = `${CONTOURS[10]} ${contourPath(0, true).replace(/^M/, "L")} Z`;
const SIGNAL_PATH = CONTOURS[3];

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
  const lightId = `loader-light-${visualId}`;
  const surfaceId = `loader-surface-${visualId}`;
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
          <div className={styles.aura} />
          <svg className={styles.sculpture} viewBox="0 0 320 250" fill="none">
            <defs>
              <linearGradient id={lightId} x1="80" y1="210" x2="242" y2="52" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="var(--loader-mint)" stopOpacity=".12" />
                <stop offset=".3" stopColor="var(--loader-mint)" stopOpacity=".95" />
                <stop offset=".55" stopColor="var(--loader-pearl)" />
                <stop offset=".76" stopColor="var(--loader-blue)" stopOpacity=".5" />
                <stop offset="1" stopColor="var(--loader-blue)" stopOpacity="0" />
              </linearGradient>
              <radialGradient id={surfaceId} cx=".28" cy=".68" r=".73">
                <stop offset="0" stopColor="var(--loader-mint)" stopOpacity=".19" />
                <stop offset=".65" stopColor="var(--loader-mint)" stopOpacity=".02" />
                <stop offset="1" stopColor="var(--loader-blue)" stopOpacity="0" />
              </radialGradient>
              <filter id={glowId} x="-120%" y="-120%" width="340%" height="340%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <g className={styles.shell}>
              <path className={styles.shellSurface} d={SHELL_SURFACE} fill={`url(#${surfaceId})`} />
              <path className={styles.shellBloom} d={CONTOURS[5]} stroke={`url(#${lightId})`} />
              {CONTOURS.map((path, index) => (
                <path key={index} className={styles.contour} d={path} stroke={`url(#${lightId})`} opacity={.14 + .4 * Math.sin((index + 1) / 12 * Math.PI)} />
              ))}
              <path className={styles.rim} d={CONTOURS[0]} stroke={`url(#${lightId})`} />
              <g className={styles.motionSignal}>
                <path className={styles.signalTrail} d={SIGNAL_PATH} pathLength="100" strokeDasharray="5 95" strokeDashoffset="5">
                  <animate attributeName="stroke-dashoffset" from="5" to="-95" dur="6.8s" repeatCount="indefinite" />
                </path>
                <g filter={`url(#${glowId})`}>
                  <rect x="-4.5" y="-4.5" width="9" height="9" rx="2.5" fill="var(--loader-amber)" />
                  <rect x="-1.5" y="-1.5" width="3" height="3" rx=".8" fill="#fff2d5" opacity=".85" />
                  <animateMotion dur="6.8s" repeatCount="indefinite" rotate="auto" path={SIGNAL_PATH} />
                </g>
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.07;.92;1" dur="6.8s" repeatCount="indefinite" />
              </g>
            </g>
            <rect className={styles.staticSignal} x="249.5" y="114.5" width="9" height="9" rx="2.5" fill="var(--loader-amber)" />
          </svg>
          <span className={styles.core}><LogoMark className={styles.mark} /></span>
          <span className={styles.starOne} />
          <span className={styles.starTwo} />
        </div>
        <p className={styles.brand} aria-hidden="true">Monstera Cloud</p>
        <h1>{title}</h1>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
      </div>
    </div>
  );
}
