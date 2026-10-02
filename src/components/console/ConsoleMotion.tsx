"use client";

import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ConsoleSyncLabel } from "@/components/dashboard/ConsoleSyncLabel";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export const CONSOLE_MOTION = { fast: 160, normal: 240, slow: 480, easing: "cubic-bezier(.2,.8,.2,1)" } as const;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Animate one content surface; never remount a second copy of a live page. */
export function ConsoleRouteTransition({ pathname, children }: { pathname: string; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const [loadingSlot, setLoadingSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setLoadingSlot(surface.current?.querySelector<HTMLElement>("[data-console-loading-slot]") ?? null); }, []);
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const normalizedParams = new URLSearchParams(query);
  // Sources canonicalizes its default view after navigation; avoid a second fade.
  if (pathname.endsWith("/sources") && normalizedParams.get("tab") === "connected") normalizedParams.delete("tab");
  const routeKey = `${pathname}?${normalizedParams.toString()}`;
  const previous = useRef({ key: routeKey, pathname });
  const [transitioning, setTransitioning] = useState(false);
  const started = useRef<number | null>(null);
  const completion = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const start = () => {
      if (completion.current) clearTimeout(completion.current);
      started.current = performance.now();
      setTransitioning(true);
    };
    window.addEventListener("monstera:navigation-start", start);
    return () => {
      window.removeEventListener("monstera:navigation-start", start);
      if (completion.current) clearTimeout(completion.current);
    };
  }, []);
  useEffect(() => {
    if (!transitioning) return;
    const timeout = setTimeout(() => setTransitioning(false), 10000);
    return () => clearTimeout(timeout);
  }, [transitioning]);
  useLayoutEffect(() => {
    const finish = (duration: number) => {
      if (completion.current) clearTimeout(completion.current);
      const remaining = Math.max(duration, 800);
      completion.current = setTimeout(() => { started.current = null; setTransitioning(false); }, remaining);
    };
    if (previous.current.key === routeKey) {
      if (started.current !== null) finish(0);
      return;
    }
    const areaChanged = previous.current.pathname !== pathname;
    previous.current = { key: routeKey, pathname };
    const duration = areaChanged ? CONSOLE_MOTION.normal : CONSOLE_MOTION.fast;
    setTransitioning(true);
    if (started.current === null) started.current = performance.now();
    finish(duration);
    if (reducedMotion()) return;
    const target = surface.current?.querySelector<HTMLElement>("[data-console-transition-content]") ?? surface.current;
    const animation = target?.animate(
      [{ opacity: areaChanged ? .65 : .85, transform: areaChanged ? "translateY(3px)" : "translateY(0)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration, easing: CONSOLE_MOTION.easing },
    );
    return () => { animation?.cancel(); };
  }, [routeKey, pathname, query]);
  const cue = <div className="console-route-indicator" role="status"><ConsoleSyncLabel active iconOnly size="large" idleLabel="" activeLabel="Loading page" idleIcon={null} /><span aria-hidden="true">Loading</span></div>;
  return <div className="console-route-boundary"><div ref={surface} className="console-route-stage">{children}</div>{transitioning && (loadingSlot ? createPortal(cue, loadingSlot) : cue)}</div>;
}

/** Preserve numeric values for screen readers while animating the visible value. */
export function ConsoleCountUp({ value, format }: { value: number; format: (value: number) => string }) {
  const [display, setDisplay] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const from = last.current;
    last.current = value;
    if (reducedMotion() || !Number.isFinite(value)) { setDisplay(value); return; }
    let frame = 0;
    const started = performance.now();
    const update = (now: number) => {
      const progress = Math.min(1, (now - started) / CONSOLE_MOTION.slow);
      setDisplay(from + (value - from) * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <><span className="sr-only">{format(value)}</span><span aria-hidden="true">{format(display)}</span></>;
}

/** Measure the selected control; only transform and opacity change during selection. */
export function SlidingControlIndicator() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const indicator = ref.current;
    const parent = indicator?.parentElement;
    if (!indicator || !parent) return;
    parent.classList.add("console-sliding-control");
    const update = () => {
      const selected = parent.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]');
      if (!selected) { indicator.style.opacity = "0"; return; }
      const rect = selected.getBoundingClientRect();
      const container = parent.getBoundingClientRect();
      indicator.style.transform = `translateX(${rect.left - container.left + parent.scrollLeft}px) scaleX(${rect.width})`;
      indicator.style.opacity = "1";
    };
    update();
    const mutations = new MutationObserver(update);
    mutations.observe(parent, { subtree: true, attributes: true, attributeFilter: ["aria-selected", "aria-pressed"] });
    const resize = new ResizeObserver(update);
    resize.observe(parent);
    parent.querySelectorAll("button").forEach(button => resize.observe(button));
    return () => { mutations.disconnect(); resize.disconnect(); parent.classList.remove("console-sliding-control"); };
  }, []);
  return <span ref={ref} aria-hidden="true" className="console-sliding-indicator" />;
}

/** Animate position deltas after sorting while retaining the real DOM order. */
export function useConsoleRowReorder(order: string) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    const animations: Animation[] = [];
    ref.current?.querySelectorAll<HTMLElement>("[data-source-connection]").forEach(row => {
      const id = row.dataset.sourceConnection!;
      const top = row.offsetTop;
      const previous = positions.current.get(id);
      next.set(id, top);
      if (previous !== undefined && previous !== top && !reducedMotion()) {
        animations.push(row.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], { duration: CONSOLE_MOTION.normal, easing: CONSOLE_MOTION.easing }));
      }
    });
    positions.current = next;
    return () => animations.forEach(animation => animation.cancel());
  }, [order]);
  return ref;
}
