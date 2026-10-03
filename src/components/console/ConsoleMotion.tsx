"use client";

import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ConsoleSyncLabel } from "@/components/dashboard/ConsoleSyncLabel";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { CONSOLE_MOTION, consoleTransitionKey } from "@/lib/console-motion";
export { CONSOLE_MOTION } from "@/lib/console-motion";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Animate one content surface; never remount a second copy of a live page. */
export function ConsoleRouteTransition({ pathname, children }: { pathname: string; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const [loadingSlot, setLoadingSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setLoadingSlot(surface.current?.querySelector<HTMLElement>("[data-console-loading-slot]") ?? null); }, []);
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const routeKey = consoleTransitionKey(pathname, query);
  const previous = useRef({ key: routeKey, pathname });
  const [transitioning, setTransitioning] = useState(false);
  const [showCue, setShowCue] = useState(false);
  useEffect(() => {
    if (!transitioning) { setShowCue(false); return; }
    const delay = setTimeout(() => setShowCue(true), CONSOLE_MOTION.loadingDelay);
    return () => clearTimeout(delay);
  }, [transitioning]);
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
      const remaining = reducedMotion() ? 0 : duration;
      completion.current = setTimeout(() => { started.current = null; setTransitioning(false); }, remaining);
    };
    if (previous.current.key === routeKey) {
      if (started.current !== null) finish(0);
      return;
    }
    const areaChanged = previous.current.pathname !== pathname;
    previous.current = { key: routeKey, pathname };
    const duration = CONSOLE_MOTION.normal;
    // The destination has committed: loading ends independently of its entrance.
    finish(0);
    if (reducedMotion()) return;
    const target = surface.current?.querySelector<HTMLElement>("[data-console-transition-content]") ?? surface.current;
    const animation = target?.animate(
      [{ opacity: .8, transform: areaChanged ? "translateY(6px)" : "translateY(2px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration, easing: CONSOLE_MOTION.easing },
    );
    return () => { animation?.cancel(); };
  }, [routeKey, pathname, query]);
  const cue = <div className="console-route-indicator" role="status"><ConsoleSyncLabel active iconOnly size="large" idleLabel="" activeLabel="Loading page" idleIcon={null} /><span aria-hidden="true">Loading</span></div>;
  return <div className="console-route-boundary"><div ref={surface} className="console-route-stage" aria-busy={transitioning}>{children}</div>{transitioning && showCue && (loadingSlot ? createPortal(cue, loadingSlot) : cue)}</div>;
}

/** Preserve numeric values for screen readers while animating the visible value. */
export function ConsoleCountUp({ value, format }: { value: number; format: (value: number) => string }) {
  const [display, setDisplay] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    const from = last.current;
    if (reducedMotion() || !Number.isFinite(value)) { last.current = value; setDisplay(value); return; }
    let frame = 0;
    const started = performance.now();
    const update = (now: number) => {
      const progress = Math.min(1, (now - started) / CONSOLE_MOTION.slow);
      const next = from + (value - from) * (1 - Math.pow(1 - progress, 3));
      last.current = next;
      setDisplay(next);
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
    indicator.style.transition = "none";
    update();
    const readyFrame = requestAnimationFrame(() => { indicator.style.transition = ""; });
    const mutations = new MutationObserver(update);
    mutations.observe(parent, { subtree: true, attributes: true, attributeFilter: ["aria-selected", "aria-pressed"] });
    const resize = new ResizeObserver(update);
    resize.observe(parent);
    parent.querySelectorAll("button").forEach(button => resize.observe(button));
    return () => { cancelAnimationFrame(readyFrame); mutations.disconnect(); resize.disconnect(); parent.classList.remove("console-sliding-control"); };
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
