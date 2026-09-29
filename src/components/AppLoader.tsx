"use client";

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const EXIT_DURATION_MS = 340;

/** Reusable console loading screen; the animation never represents task progress. */
export function AppLoader({
  visible,
  title = "Preparing your workspace",
  detail = "Getting things ready",
  minVisibleMs = 300,
}: {
  visible: boolean;
  title?: string;
  detail?: string;
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
    <div className={styles.overlay} data-visible={shown} role="status" aria-live="polite" aria-label={`${title}. ${detail}.`}>
      <span className={styles.atmosphere} aria-hidden="true" />
      <div className={styles.content}>
        <div className={styles.motion} aria-hidden="true">
          <span className={styles.motionAura} />
          <span className={`${styles.track} ${styles.trackRear}`} />
          <span className={`${styles.track} ${styles.trackFront}`} />
          <span className={`${styles.orbitMotion} ${styles.orbitAmber}`}><span className={styles.signalBlock} /></span>
          <span className={`${styles.orbitMotion} ${styles.orbitMint}`}><span className={styles.signalDot} /></span>
          <span className={styles.core}><LogoMark className={styles.mark} /></span>
          <span className={styles.coreHalo} />
        </div>
        <p className={styles.wordmark} aria-hidden="true"><span />MONSTERA CLOUD</p>
        <h1>{title}</h1>
        <p className={styles.detail}>{detail}</p>
      </div>
    </div>
  );
}
