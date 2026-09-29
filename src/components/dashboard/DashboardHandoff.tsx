"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useWorkspaceStartup } from "../WorkspaceStartup";
import { DashboardSkeleton } from "./DashboardSkeleton";
import styles from "./DashboardHandoff.module.css";

// Keep one accessible destination. No synchronous DOM snapshots at response time.
export function DashboardHandoff({ ready, children }: { ready: boolean; children: ReactNode }) {
  const startup = useWorkspaceStartup();
  const handoff = startup?.handoff ?? true;
  // A page mounted after the initial handoff never replays the startup choreography.
  const [enteredDuringStartup] = useState(() => !handoff);
  const [retained, setRetained] = useState(true);
  useEffect(() => {
    if (!ready || !handoff) return;
    const timer = setTimeout(() => setRetained(false), 600);
    return () => clearTimeout(timer);
  }, [ready, handoff]);
  return <div className={styles.frame} data-ready={ready} data-reveal={handoff} data-motion={enteredDuringStartup && Boolean(startup?.animateHandoff)}>
    {ready && retained && <div className={styles.outgoing} aria-hidden inert>
      <svg viewBox="0 0 1200 900" preserveAspectRatio="none" aria-hidden="true">
        <rect x="32" y="40" width="200" height="24" rx="4" />
        <rect x="32" y="82" width="370" height="10" rx="4" />
        <rect x="32" y="120" width="1136" height="54" rx="8" />
        {[0,1,2,3].map(i => <rect key={i} x={32+i*288} y="260" width="272" height="130" rx="8" />)}
        <rect x="32" y="430" width="710" height="240" rx="8" />
        <rect x="762" y="430" width="406" height="240" rx="8" />
      </svg>
    </div>}
    {ready ? <div className={styles.real} data-workspace-content>{children}</div> : <DashboardSkeleton />}
  </div>;
}
