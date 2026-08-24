"use client";

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * Lightweight app-shell loader. It deliberately uses local SVG/CSS only: the
 * first screen must never wait on a map download or third-party script.
 */
export type GlobeLoaderHandle = { show: () => void; hide: () => void };

export interface GlobeLoaderProps {
  visible?: boolean;
  minVisibleMs?: number;
  /** Retained for backwards-compatible visual tuning. */
  spinSpeedDegPerSec?: number;
  /** Retained for backwards-compatible visual tuning. */
  globeWeight?: number;
  fullscreen?: boolean;
  className?: string;
}

export const GlobeLoader = React.forwardRef<GlobeLoaderHandle, GlobeLoaderProps>(
  function GlobeLoader(
    {
      visible = true,
      minVisibleMs = 480,
      spinSpeedDegPerSec = 18,
      globeWeight = 1,
      fullscreen = true,
      className = "",
    },
    ref,
  ) {
    const [mounted, setMounted] = useState(visible);
    const [shown, setShown] = useState(visible);
    const shownAt = useRef(visible ? Date.now() : 0);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimers = useCallback(() => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
      hideTimer.current = null;
      unmountTimer.current = null;
    }, []);

    const show = useCallback(() => {
      clearTimers();
      shownAt.current = Date.now();
      setMounted(true);
      requestAnimationFrame(() => setShown(true));
    }, [clearTimers]);

    const hide = useCallback(() => {
      clearTimers();
      const remaining = Math.max(0, minVisibleMs - (Date.now() - shownAt.current));
      hideTimer.current = setTimeout(() => {
        setShown(false);
        unmountTimer.current = setTimeout(() => setMounted(false), 220);
      }, remaining);
    }, [clearTimers, minVisibleMs]);

    useEffect(() => {
      if (visible) show();
      else hide();
      return clearTimers;
    }, [visible, show, hide, clearTimers]);

    useImperativeHandle(ref, () => ({ show, hide }), [show, hide]);
    if (!mounted) return null;

    const orbitSeconds = `${Math.max(7, Math.round(270 / Math.max(1, spinSpeedDegPerSec)))}s`;
    const lineWeight = Math.min(1.8, Math.max(0.7, globeWeight));
    const containerStyle: React.CSSProperties = fullscreen
      ? {
          position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center",
          background: "#070909", opacity: shown ? 1 : 0, transition: "opacity 220ms ease",
          pointerEvents: visible ? "auto" : "none",
        }
      : { display: "grid", placeItems: "center", opacity: shown ? 1 : 0, transition: "opacity 220ms ease" };

    return (
      <div className={className} role="status" aria-live="polite" aria-label="Preparing your workspace" style={containerStyle}>
        <div className="mc-loader-shell">
          <div className="mc-loader-mark" aria-hidden="true">
            <div className="mc-loader-glow" />
            <svg viewBox="0 0 132 132" fill="none" className="mc-loader-svg">
              <circle cx="66" cy="66" r="39" className="mc-loader-sphere" strokeWidth={lineWeight} />
              <ellipse cx="66" cy="66" rx="18" ry="39" className="mc-loader-grid" strokeWidth={lineWeight * 0.72} />
              <path d="M28 66h76M34 46h64M34 86h64" className="mc-loader-grid" strokeWidth={lineWeight * 0.72} />
              <g className="mc-loader-orbit" style={{ animationDuration: orbitSeconds }}>
                <path d="M18 68c12-33 83-48 98-9" className="mc-loader-orbit-line" strokeWidth={lineWeight} />
                <circle cx="111" cy="55" r="2.5" className="mc-loader-node" />
              </g>
            </svg>
          </div>
          <p className="mc-loader-wordmark">MONSTERA</p>
          <p className="mc-loader-title">Preparing your workspace</p>
          <p className="mc-loader-subtitle">Checking your secure session</p>
        </div>
        <style>{`
          .mc-loader-shell { display:grid; justify-items:center; gap:8px; text-align:center; }
          .mc-loader-mark { position:relative; width:132px; height:132px; margin-bottom:10px; }
          .mc-loader-svg { position:relative; z-index:1; width:132px; height:132px; overflow:visible; }
          .mc-loader-glow { position:absolute; inset:18px; border-radius:999px; background:radial-gradient(circle, rgba(111,255,213,.13), rgba(111,255,213,0) 68%); animation:mc-loader-breathe 2.8s ease-in-out infinite; }
          .mc-loader-sphere { stroke:rgba(239,255,251,.7); }
          .mc-loader-grid { stroke:rgba(168,210,198,.24); }
          .mc-loader-orbit { transform-origin:66px 66px; animation:mc-loader-spin linear infinite; }
          .mc-loader-orbit-line { stroke:rgba(118,244,206,.78); stroke-linecap:round; }
          .mc-loader-node { fill:#b9ffe6; }
          .mc-loader-wordmark { margin:0; color:rgba(255,255,255,.42); font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.22em; }
          .mc-loader-title { margin:5px 0 0; color:#f2f8f6; font-size:14px; font-weight:600; letter-spacing:-.01em; }
          .mc-loader-subtitle { margin:0; color:rgba(225,240,235,.52); font-size:12px; }
          @keyframes mc-loader-spin { to { transform:rotate(360deg); } }
          @keyframes mc-loader-breathe { 0%,100% { opacity:.55; transform:scale(.94); } 50% { opacity:1; transform:scale(1.08); } }
          @media (prefers-reduced-motion: reduce) { .mc-loader-glow,.mc-loader-orbit { animation:none !important; } }
        `}</style>
      </div>
    );
  },
);

export default GlobeLoader;
