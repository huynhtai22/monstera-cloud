"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./Onboarding.module.css";

/** Animate geometry only when task identity/state changes, never on polling alone. */
export function SpecialistStack({ revision, children }: { revision: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const previousHeight = useRef<number | null>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const frame = outer.current;
    const content = inner.current;
    if (!frame || !content) return;
    const nextHeight = content.getBoundingClientRect().height;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animations: Animation[] = [];
    const nextPositions = new Map<string, number>();
    content.querySelectorAll<HTMLElement>("[data-specialist-id]").forEach((item, index) => {
      const id = item.dataset.specialistId!;
      const top = item.offsetTop;
      const previous = positions.current.get(id);
      nextPositions.set(id, top);
      if (reduced) return;
      if (previous === undefined) {
        animations.push(item.animate([{ opacity: 0, transform: "translateY(12px) scale(.985)" }, { opacity: 1, transform: "translateY(0) scale(1)" }], { duration: 520, delay: Math.min(index * 55, 165), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
      } else if (Math.abs(previous - top) > 1) {
        animations.push(item.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], { duration: 400, easing: "cubic-bezier(.16,1,.3,1)" }));
      }
    });
    if (!reduced && previousHeight.current !== null && Math.abs(previousHeight.current - nextHeight) > 1) {
      animations.push(frame.animate([{ height: `${previousHeight.current}px` }, { height: `${nextHeight}px` }], { duration: 400, easing: "cubic-bezier(.16,1,.3,1)" }));
    }
    previousHeight.current = nextHeight;
    positions.current = nextPositions;
    // Track user-driven accordion height changes without replaying card arrivals.
    const observer = new ResizeObserver(() => { previousHeight.current = content.getBoundingClientRect().height; });
    observer.observe(content);
    return () => { observer.disconnect(); animations.forEach(animation => animation.cancel()); };
  }, [revision]);
  return <div ref={outer} className={styles.stackFrame}><div ref={inner} className={styles.taskList}>{children}</div></div>;
}
