"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useWorkspaceStartup } from "../WorkspaceStartup";
import { DashboardSkeleton } from "./DashboardSkeleton";
import styles from "./DashboardHandoff.module.css";

export function DashboardHandoff({ ready, children }: { ready: boolean; children: ReactNode }) {
  const startup = useWorkspaceStartup();
  const handoff = startup?.handoff ?? true;
  const [enteredDuringStartup] = useState(() => !handoff);
  const [retained, setRetained] = useState(true);
  const real = useRef<HTMLDivElement>(null);
  const outgoing = useRef<HTMLDivElement>(null);
  const motions = useRef<Animation[]>([]);
  const placeholder = useRef<Animation | null>(null);
  const current = useRef({ handoff, animate: Boolean(startup?.animateHandoff), fade: Boolean(startup?.fadeHandoff) });
  useLayoutEffect(() => { current.current = { handoff, animate: Boolean(startup?.animateHandoff), fade: Boolean(startup?.fadeHandoff) }; });
  // Prepare layers under the cover, before Resolve. No subtree selector changes at travel time.
  useLayoutEffect(() => {
    if (!ready || !real.current) return;
    if (!enteredDuringStartup || current.current.handoff) {
      if (outgoing.current) outgoing.current.style.opacity = "0";
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const section = real.current.querySelector('[data-console-section="dashboard"]');
    const targets = section ? Array.from(section.children) : [real.current];
    motions.current = targets.map((target, index) => {
      const animation = target.animate([
        { opacity: 0, transform: reduced ? "none" : "translateY(12px)" },
        { opacity: 1, transform: reduced ? "none" : "translateY(0)" },
      ], { duration: 150, delay: reduced ? 0 : Math.min(index,3)*40, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" });
      animation.pause();
      return animation;
    });
    placeholder.current = outgoing.current?.animate([{opacity:1},{opacity:0}], {duration:100,easing:"ease-in-out",fill:"both"}) ?? null;
    placeholder.current?.pause();
    return () => { motions.current.forEach(a => a.cancel()); placeholder.current?.cancel(); motions.current = []; };
  }, [ready, enteredDuringStartup]);
  useEffect(() => {
    if (!ready || !handoff || !real.current) return;
    if (current.current.animate) motions.current.forEach(a => a.play());
    else {
      motions.current.forEach(a => a.cancel());
      if (current.current.fade) real.current.animate([{opacity:0},{opacity:1}], {duration:150,easing:"ease-in-out",fill:"both"});
    }
    placeholder.current?.play();
    const timer = setTimeout(() => setRetained(false), 300);
    return () => clearTimeout(timer);
  }, [ready, handoff]);
  return <div className={styles.frame} data-ready={ready} data-reveal={handoff}>
    {ready && retained && enteredDuringStartup && <div ref={outgoing} className={styles.outgoing} aria-hidden inert>
      <svg viewBox="0 0 1200 900" preserveAspectRatio="none" aria-hidden="true">
        <rect x="32" y="40" width="200" height="24" rx="4" />
        <rect x="32" y="82" width="370" height="10" rx="4" />
        <rect x="32" y="120" width="1136" height="54" rx="8" />
        {[0,1,2,3].map(i => <rect key={i} x={32+i*288} y="260" width="272" height="130" rx="8" />)}
        <rect x="32" y="430" width="710" height="240" rx="8" />
        <rect x="762" y="430" width="406" height="240" rx="8" />
      </svg>
    </div>}
    {ready ? <div ref={real} className={styles.real} data-workspace-content>{children}</div> : <DashboardSkeleton />}
  </div>;
}
