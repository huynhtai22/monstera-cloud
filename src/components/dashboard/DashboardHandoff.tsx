"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useWorkspaceStartup } from "../WorkspaceStartup";
import { DashboardSkeleton } from "./DashboardSkeleton";
import styles from "./DashboardHandoff.module.css";

export function DashboardHandoff({ ready, children }: { ready: boolean; children: ReactNode }) {
  const [retained, setRetained] = useState(true);
  const handoff = useWorkspaceStartup()?.handoff ?? true;
  const real = useRef<HTMLDivElement>(null);
  const snapshot = useRef<HTMLDivElement>(null);
  // Once the response arrives, the outgoing placeholders use the exact final geometry,
  // including optional onboarding panels, source counts and multi-currency rows.
  useLayoutEffect(() => {
    if (!ready || !real.current || !snapshot.current) return;
    const clone = real.current.cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-workspace-content");
    clone.querySelectorAll("[id], [role], [data-workspace-content]").forEach(node => {
      node.removeAttribute("id");
      node.removeAttribute("role");
      node.removeAttribute("data-workspace-content");
    });
    snapshot.current.replaceChildren(clone);
  }, [ready]);
  useEffect(() => {
    if (!ready || !handoff) return;
    const timer = setTimeout(() => setRetained(false), matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 400);
    return () => clearTimeout(timer);
  }, [ready, handoff]);
  return (
    <div className={styles.frame} data-ready={ready} data-reveal={handoff}>
      {ready && <div ref={real} className={styles.real} data-workspace-content>{children}</div>}
      {(!ready || retained) && <div className={styles.skeleton} aria-hidden={ready || undefined} inert={ready || undefined}>
        {ready ? <div ref={snapshot} className={styles.snapshot} /> : <DashboardSkeleton />}
      </div>}
    </div>
  );
}
