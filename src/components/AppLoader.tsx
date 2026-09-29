"use client";

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const SESSION_KEY = "monstera-workspace-intro-seen";
const SHOW_DELAY_MS = 200;
const MIN_VISIBLE_MS = 600;
const EXIT_DURATION_MS = 480;

/** First-document session preparation. Route navigation and repeat visits skip the intro. */
export function AppLoader({
  visible,
  locale,
  onExitStart,
}: {
  visible: boolean;
  locale?: "en" | "vi";
  onExitStart?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<"enter" | "exit">("enter");
  const [fontsReady, setFontsReady] = useState(false);
  const [readiness, setReadiness] = useState(0);
  const [language, setLanguage] = useState<"en" | "vi">("en");
  const shownAt = useRef(0);
  const skipIntro = useRef<boolean | null>(null);
  const pending = visible || !fontsReady;

  useEffect(() => {
    let active = true;
    try {
      const saved = localStorage.getItem("marketing_lang");
      setLanguage(saved === "vi" || (!saved && navigator.language.startsWith("vi")) ? "vi" : "en");
    } catch {
      setLanguage(navigator.language.startsWith("vi") ? "vi" : "en");
    }
    // The app uses system fonts and has no shared hero image to await.
    // The two completion signals are browser font readiness and NextAuth session readiness.
    void document.fonts.ready.then(() => {
      if (active) setFontsReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const completed = (fontsReady ? .5 : 0) + (visible ? 0 : .5);
    setReadiness(current => Math.max(current, completed));
  }, [fontsReady, visible]);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let removeTimer: ReturnType<typeof setTimeout> | undefined;

    if (skipIntro.current === null) {
      const navigation = performance.getEntriesByType("navigation")[0];
      const enteredOnAnotherRoute = navigation && new URL(navigation.name).pathname !== location.pathname;
      let seen = false;
      try { seen = sessionStorage.getItem(SESSION_KEY) === "1"; } catch { /* Storage may be unavailable. */ }
      skipIntro.current = Boolean(enteredOnAnotherRoute || seen);
    }

    if (pending && !mounted && !skipIntro.current) {
      showTimer = setTimeout(() => {
        shownAt.current = performance.now();
        setPhase("enter");
        setMounted(true);
        try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* The intro still works without storage. */ }
      }, SHOW_DELAY_MS);
    } else if (!pending && mounted) {
      const remaining = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt.current));
      exitTimer = setTimeout(() => {
        setPhase("exit");
        onExitStart?.();
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        removeTimer = setTimeout(() => {
          setMounted(false);
          skipIntro.current = true;
        }, reduced ? 150 : EXIT_DURATION_MS);
      }, remaining);
    }

    return () => {
      clearTimeout(showTimer);
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [pending, mounted, onExitStart]);

  if (!mounted) return null;
  const lang = locale ?? language;
  const status = lang === "vi" ? "Đang chuẩn bị không gian làm việc" : "Preparing your workspace";

  return (
    <div className={styles.overlay} data-phase={phase} role="status" aria-live="polite" aria-label={status} lang={lang}>
      <div className={styles.content}>
        {/* Geometry matches public/logo-mark.svg, through the shared canonical LogoMark. */}
        <div className={styles.emblem} aria-hidden="true"><LogoMark className={styles.mark} /></div>
        <p className={styles.wordmark} aria-hidden="true">Monstera Cloud</p>
        <p className={styles.status} aria-hidden="true">{status}</p>
        <div className={styles.readiness} aria-hidden="true">
          <span style={{ transform: `scaleX(${readiness})` }} />
        </div>
      </div>
    </div>
  );
}
