"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

/**
 * GlobeLoader — spinning Earth + cyan whirl.
 *
 * Drop-in usage:
 *   const [loading, setLoading] = useState(true);
 *   <GlobeLoader visible={loading} />
 *
 * Or use the imperative API via a ref:
 *   const ref = useRef<GlobeLoaderHandle>(null);
 *   ref.current?.show(); ref.current?.hide();
 *
 * The loader enforces a MIN_VISIBLE_MS so fast loads don't flash,
 * and fades in/out smoothly on mount/unmount.
 */

// --- External deps loaded from CDN the first time the component mounts ---
// If you prefer npm packages, install `d3-geo` + `topojson-client` and
// replace these dynamic imports with static ones.
const D3_SRC = "https://unpkg.com/d3@7.9.0/dist/d3.min.js";
const TOPO_SRC = "https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js";
const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";

declare global {
    interface Window {
        d3?: any;
        topojson?: any;
    }
}

function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load " + src));
        document.head.appendChild(s);
    });
}

export type GlobeLoaderHandle = {
    show: () => void;
    hide: () => void;
};

export interface GlobeLoaderProps {
    /** Controlled visibility. If omitted, defaults to true. */
    visible?: boolean;
    /** Minimum time the loader stays on screen once shown (ms). */
    minVisibleMs?: number;
    /** Strength of cyan tint (0–100). Higher = more brand cyan, less slate. */
    cyanIntensity?: number;
    /** Globe rotation speed in degrees/second. */
    spinSpeedDegPerSec?: number;
    /** Stroke weight multiplier for country outlines (0.5 – 2). */
    globeWeight?: number;
    /** Whether this covers the whole viewport (fixed overlay). Default true. */
    fullscreen?: boolean;
    /** Optional className for outer container. */
    className?: string;
}

export const GlobeLoader = React.forwardRef<GlobeLoaderHandle, GlobeLoaderProps>(
    function GlobeLoader(
        {
            visible = true,
            minVisibleMs = 700,
            cyanIntensity = 25,
            spinSpeedDegPerSec = 18,
            globeWeight = 1,
            fullscreen = true,
            className = "",
        },
        ref
    ) {
        const canvasRef = useRef<HTMLCanvasElement | null>(null);
        const [internalVisible, setInternalVisible] = useState(visible);
        const [mounted, setMounted] = useState(visible);
        const shownAtRef = useRef<number>(0);

        // Refs for drawing so prop changes don't tear down rAF
        const cyanRef = useRef(cyanIntensity);
        const speedRef = useRef(spinSpeedDegPerSec);
        const weightRef = useRef(globeWeight);
        useEffect(() => {
            cyanRef.current = cyanIntensity;
        }, [cyanIntensity]);
        useEffect(() => {
            speedRef.current = spinSpeedDegPerSec;
        }, [spinSpeedDegPerSec]);
        useEffect(() => {
            weightRef.current = globeWeight;
        }, [globeWeight]);

        // Sync controlled `visible` into our min-time aware state
        useEffect(() => {
            if (visible) {
                setMounted(true);
                // next frame so CSS transition plays
                requestAnimationFrame(() => setInternalVisible(true));
                shownAtRef.current = Date.now();
            } else {
                const elapsed = Date.now() - shownAtRef.current;
                const wait = Math.max(0, minVisibleMs - elapsed);
                const t = setTimeout(() => {
                    setInternalVisible(false);
                    // wait for fade-out before unmounting
                    setTimeout(() => setMounted(false), 320);
                }, wait);
                return () => clearTimeout(t);
            }
        }, [visible, minVisibleMs]);

        // Imperative API
        const showImp = useCallback(() => {
            setMounted(true);
            requestAnimationFrame(() => setInternalVisible(true));
            shownAtRef.current = Date.now();
        }, []);
        const hideImp = useCallback(() => {
            const elapsed = Date.now() - shownAtRef.current;
            const wait = Math.max(0, minVisibleMs - elapsed);
            setTimeout(() => {
                setInternalVisible(false);
                setTimeout(() => setMounted(false), 320);
            }, wait);
        }, [minVisibleMs]);
        React.useImperativeHandle(ref, () => ({ show: showImp, hide: hideImp }), [showImp, hideImp]);

        // Globe drawing effect
        useEffect(() => {
            if (!mounted) return;
            const canvas = canvasRef.current;
            if (!canvas) return;

            let raf = 0;
            let lambda = 0;
            let lastTs = 0;
            let land: any = null;
            let borders: any = null;
            let disposed = false;
            const DPR = 2;
            const CSS_SIZE = 200;
            const DPR_SIZE = CSS_SIZE * DPR;
            const CENTER = DPR_SIZE / 2;
            const RADIUS = 72 * DPR;

            canvas.width = DPR_SIZE;
            canvas.height = DPR_SIZE;
            const ctx = canvas.getContext("2d")!;

            let projection: any, path: any;

            const lerp = (h1: string, h2: string, t: number) => {
                const p = (h: string) => [
                    parseInt(h.slice(1, 3), 16),
                    parseInt(h.slice(3, 5), 16),
                    parseInt(h.slice(5, 7), 16),
                ];
                const [r1, g1, b1] = p(h1);
                const [r2, g2, b2] = p(h2);
                return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
            };

            const draw = () => {
                if (!projection) return;
                const t = Math.max(0, Math.min(1, cyanRef.current / 100));
                const w = weightRef.current;
                const landFill = lerp("#cbd5e1", "#a5f3fc", t);
                const landStroke = lerp("#1e293b", "#0e7490", t);
                const borderCol = lerp("#334155", "#0891b2", t);
                const sphereRim = lerp("#475569", "#0891b2", t);

                ctx.clearRect(0, 0, DPR_SIZE, DPR_SIZE);

                ctx.beginPath();
                path({ type: "Sphere" });
                ctx.fillStyle = "#ffffff";
                ctx.fill();

                // graticule
                ctx.beginPath();
                path(window.d3.geoGraticule10());
                ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
                ctx.lineWidth = 0.6 * DPR;
                ctx.stroke();

                if (land) {
                    ctx.beginPath();
                    path(land);
                    ctx.fillStyle = landFill;
                    ctx.fill();

                    ctx.beginPath();
                    path(land);
                    ctx.strokeStyle = landStroke;
                    ctx.lineWidth = 1.3 * DPR * w;
                    ctx.lineJoin = "round";
                    ctx.stroke();

                    if (borders) {
                        ctx.beginPath();
                        path(borders);
                        ctx.strokeStyle = borderCol;
                        ctx.lineWidth = 0.7 * DPR * w;
                        ctx.globalAlpha = 0.85;
                        ctx.stroke();
                        ctx.globalAlpha = 1;
                    }
                }

                ctx.beginPath();
                path({ type: "Sphere" });
                ctx.strokeStyle = sphereRim;
                ctx.lineWidth = 1.4 * DPR;
                ctx.stroke();
            };

            const tick = (ts: number) => {
                if (disposed) return;
                if (!lastTs) lastTs = ts;
                const dt = (ts - lastTs) / 1000;
                lastTs = ts;
                lambda = (lambda + speedRef.current * dt) % 360;
                projection.rotate([lambda, -12, 0]);
                draw();
                raf = requestAnimationFrame(tick);
            };

            (async () => {
                try {
                    await loadScript(D3_SRC);
                    await loadScript(TOPO_SRC);
                    if (disposed) return;
                    projection = window.d3
                        .geoOrthographic()
                        .scale(RADIUS)
                        .translate([CENTER, CENTER])
                        .clipAngle(90);
                    path = window.d3.geoPath(projection, ctx);
                    raf = requestAnimationFrame(tick);

                    const res = await fetch(TOPO_URL);
                    const topo = await res.json();
                    if (disposed) return;
                    land = window.topojson.feature(topo, topo.objects.countries);
                    borders = window.topojson.mesh(
                        topo,
                        topo.objects.countries,
                        (a: any, b: any) => a !== b
                    );
                } catch (e) {
                    // fail silently — we keep rendering the sphere
                    console.warn("GlobeLoader deps failed", e);
                }
            })();

            return () => {
                disposed = true;
                cancelAnimationFrame(raf);
            };
        }, [mounted]);

        if (!mounted) return null;

        const containerStyle: React.CSSProperties = fullscreen
            ? {
                  position: "fixed",
                  inset: 0,
                  background: "#f8fafc",
                  display: "grid",
                  placeItems: "center",
                  zIndex: 9999,
                  opacity: internalVisible ? 1 : 0,
                  transform: internalVisible ? "scale(1)" : "scale(1.06)",
                  transition: "opacity 300ms ease, transform 300ms ease",
                  pointerEvents: internalVisible ? "auto" : "none",
              }
            : {
                  display: "grid",
                  placeItems: "center",
                  opacity: internalVisible ? 1 : 0,
                  transform: internalVisible ? "scale(1)" : "scale(0.96)",
                  transition: "opacity 300ms ease, transform 300ms ease",
              };

        return (
            <div
                className={className}
                role="status"
                aria-label="Loading"
                style={containerStyle}
            >
                <div
                    style={{
                        position: "relative",
                        width: 200,
                        height: 200,
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    {/* Halo */}
                    <div
                        aria-hidden
                        style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            background:
                                "radial-gradient(circle at center, rgba(6,182,212,0.14) 0%, transparent 62%)",
                            animation: "mgl-halo 2.4s ease-in-out infinite",
                            zIndex: 1,
                        }}
                    />

                    {/* Whirl */}
                    <div
                        aria-hidden
                        style={{ position: "absolute", inset: 0, width: 200, height: 200, zIndex: 3 }}
                    >
                        <svg viewBox="0 0 200 200" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                            <defs>
                                <linearGradient id="mgl-whirlGrad" x1="0" y1="0" x2="1" y2="0">
                                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
                                    <stop offset="55%" stopColor="#06b6d4" stopOpacity="0.85" />
                                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                                </linearGradient>
                            </defs>

                            <circle cx="100" cy="100" r="98" stroke="#cbd5e1" strokeWidth="0.6" strokeOpacity="0.55" fill="none" />

                            <g className="mgl-ring mgl-ring-3">
                                <path d="M 100 8 A 92 92 0 0 1 192 100" stroke="url(#mgl-whirlGrad)" strokeWidth="3" fill="none" />
                                <path d="M 100 192 A 92 92 0 0 1 8 100" stroke="url(#mgl-whirlGrad)" strokeWidth="3" fill="none" />
                            </g>

                            <circle
                                className="mgl-ring mgl-ring-2"
                                cx="100"
                                cy="100"
                                r="84"
                                stroke="#0891b2"
                                strokeOpacity="0.7"
                                strokeWidth="1.2"
                                strokeDasharray="2 6"
                                fill="none"
                            />

                            <g className="mgl-ring mgl-ring-1">
                                <path
                                    d="M 100 23 A 77 77 0 0 1 177 100"
                                    stroke="#0891b2"
                                    strokeOpacity="0.95"
                                    strokeWidth="2.4"
                                    strokeLinecap="round"
                                    fill="none"
                                />
                                <path
                                    d="M 100 177 A 77 77 0 0 1 23 100"
                                    stroke="#06b6d4"
                                    strokeOpacity="0.55"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    fill="none"
                                />
                            </g>

                            <g className="mgl-particles">
                                <circle cx="100" cy="8" r="2.2" fill="#0891b2" />
                                <circle cx="192" cy="100" r="1.6" fill="#06b6d4" />
                                <circle cx="100" cy="192" r="1.3" fill="#67e8f9" />
                            </g>
                        </svg>
                    </div>

                    {/* Globe */}
                    <canvas
                        ref={canvasRef}
                        style={{
                            position: "absolute",
                            inset: 0,
                            width: 200,
                            height: 200,
                            zIndex: 2,
                            filter: "drop-shadow(0 1px 0 rgba(15,23,42,0.04))",
                        }}
                    />
                </div>

                <style>{`
          @keyframes mgl-spin { to { transform: rotate(360deg); } }
          @keyframes mgl-halo {
            0%, 100% { transform: scale(0.96); opacity: 0.55; }
            50%      { transform: scale(1.04); opacity: 0.9;  }
          }
          .mgl-ring {
            transform-origin: 100px 100px;
            transform-box: view-box;
          }
          .mgl-ring-1 { animation: mgl-spin 3.2s linear infinite; }
          .mgl-ring-2 { animation: mgl-spin 5.5s linear infinite reverse; }
          .mgl-ring-3 { animation: mgl-spin 8s   linear infinite; }
          .mgl-particles {
            animation: mgl-spin 4.6s linear infinite reverse;
            transform-origin: 100px 100px;
            transform-box: view-box;
          }
        `}</style>
            </div>
        );
    }
);

export default GlobeLoader;
