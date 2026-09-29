"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import styles from "./AppLoader.module.css";

const SESSION_KEY = "monstera-workspace-intro-seen";
const SHOW_DELAY_MS = 200;
const MIN_VISIBLE_MS = 600;
const EXIT_DURATION_MS = 320;

/** The opaque cover is server rendered; its mark appears after 200ms only if still pending. */
export function AppLoader({ visible, sessionVerified = false, workspaceReturned = false, measurable = false, locale, onExitStart }: {
  visible: boolean;
  sessionVerified?: boolean;
  workspaceReturned?: boolean;
  measurable?: boolean;
  locale?: "en" | "vi";
  onExitStart?: () => void;
}) {
  const [mounted, setMounted] = useState(true);
  const [phase, setPhase] = useState<"enter" | "exit">("enter");
  const [readiness, setReadiness] = useState(0);
  const [language, setLanguage] = useState<"en" | "vi">("en");
  const showAt = useRef<number | null>(null);
  const skipped = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("marketing_lang");
      setLanguage(saved === "vi" || (!saved && navigator.language.startsWith("vi")) ? "vi" : "en");
    } catch { setLanguage(navigator.language.startsWith("vi") ? "vi" : "en"); }
  }, []);

  useEffect(() => {
    setReadiness(current => Math.max(current, (sessionVerified ? .5 : 0) + (workspaceReturned ? .5 : 0)));
  }, [sessionVerified, workspaceReturned]);

  useLayoutEffect(() => {
    if (!mounted || skipped.current) return;
    if (showAt.current === null) {
      const root = document.documentElement;
      const navigation = performance.getEntriesByType("navigation")[0];
      const clientNavigation = navigation && new URL(navigation.name).pathname !== location.pathname;
      let seen = root.dataset.monsteraStartup === "skip";
      try { seen ||= sessionStorage.getItem(SESSION_KEY) === "1"; } catch { /* Storage is optional. */ }
      if (seen || clientNavigation || location.pathname.startsWith("/invite/")) {
        skipped.current = true;
        setMounted(false);
        onExitStart?.();
        return;
      }
      const entrance = document.querySelector("[data-workspace-loader]")?.firstElementChild?.getAnimations()[0];
      const start = typeof entrance?.startTime === "number" ? entrance.startTime : Number(root.dataset.monsteraStartupAt ?? performance.now());
      showAt.current = start + SHOW_DELAY_MS;
    }
    const appearance = showAt.current;
    let removeTimer: ReturnType<typeof setTimeout> | undefined;
    const remember = () => { try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* Storage is optional. */ } };
    if (visible) {
      const timer = setTimeout(remember, Math.max(0, appearance - performance.now()));
      return () => clearTimeout(timer);
    }
    if (performance.now() < appearance) {
      remember();
      setMounted(false);
      onExitStart?.();
      return;
    }
    remember();
    const timer = setTimeout(() => {
      setPhase("exit");
      onExitStart?.();
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      removeTimer = setTimeout(() => setMounted(false), reduced ? 150 : EXIT_DURATION_MS);
    }, Math.max(0, appearance + MIN_VISIBLE_MS - performance.now()));
    return () => { clearTimeout(timer); clearTimeout(removeTimer); };
  }, [visible, mounted, onExitStart]);

  if (!mounted) return null;
  const lang = locale ?? language;
  const status = lang === "vi" ? "Đang chuẩn bị không gian làm việc" : "Preparing your workspace";
  return (
    <div className={styles.overlay} data-phase={phase} data-workspace-loader role="status" aria-live="polite" aria-label={status} lang={lang}>
      <div className={styles.content}>
        <div className={styles.emblem} aria-hidden="true"><LogoMark className={styles.mark} /></div>
        <p className={styles.wordmark} aria-hidden="true">Monstera Cloud</p>
        <p className={styles.status} aria-hidden="true">{status}</p>
        <div className={styles.readiness} data-measurable={measurable} aria-hidden="true">
          <span style={measurable ? { transform: `scaleX(${readiness})` } : undefined} />
        </div>
      </div>
    </div>
  );
}
