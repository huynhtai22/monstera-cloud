"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type MarketingScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

/** A small, progressive-enhancement reveal for the public marketing site. */
export function MarketingScrollReveal({ children, className = "", delay = 0 }: MarketingScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setEnabled(true);
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.14 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} ${enabled ? "reveal-motion" : ""} ${enabled && !visible ? "reveal-off" : "reveal-on"}`}
      style={enabled && visible && delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
