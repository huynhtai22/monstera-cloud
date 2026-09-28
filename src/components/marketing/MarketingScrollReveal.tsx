"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type MarketingScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  cinematic?: boolean;
};

/** A small, progressive-enhancement reveal for the public marketing site. */
export function MarketingScrollReveal({ children, className = "", delay = 0, cinematic = false }: MarketingScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches || !("IntersectionObserver" in window)) return;

    // Only prepare offscreen content; server-rendered and above-fold content stays readable.
    if (cinematic && element.getBoundingClientRect().top >= window.innerHeight) {
      element.dataset.revealPending = "true";
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setEntered(true);
        observer.disconnect();
      }
    }, { threshold: cinematic ? 0 : 0.14, rootMargin: cinematic ? "0px 0px -32px 0px" : "0px" });
    const showWithoutMotion = () => {
      if (motion.matches) {
        delete element.dataset.revealPending;
        setEntered(true);
        observer.disconnect();
      }
    };
    observer.observe(element);
    motion.addEventListener("change", showWithoutMotion);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", showWithoutMotion);
      delete element.dataset.revealPending;
    };
  }, [cinematic]);

  return (
    <div
      ref={ref}
      onFocusCapture={() => {
        if (ref.current) ref.current.dataset.revealFocused = "true";
        setEntered(true);
      }}
      className={`${className} ${cinematic ? "mh-motion-reveal" : ""} ${entered ? "reveal-enter" : ""}`}
      style={entered && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
