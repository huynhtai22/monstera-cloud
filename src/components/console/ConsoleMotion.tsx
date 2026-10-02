"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export const CONSOLE_MOTION = { fast: 160, normal: 240, slow: 480, easing: "cubic-bezier(.2,.8,.2,1)" } as const;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Keep the sidebar outside this boundary and retire the previous page after the fade. */
export function ConsoleRouteTransition({ pathname, children }: { pathname: string; children: ReactNode }) {
  return <div className="console-route-stage">
    <div key={pathname} className="console-route-enter">{children}</div>
  </div>;
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
