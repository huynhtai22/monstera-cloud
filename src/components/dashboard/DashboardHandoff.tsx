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
    const bounds = real.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const rectangle = (box: DOMRect, line: boolean) => {
      if (!box.width || !box.height) return;
      const shape = document.createElementNS(svg.namespaceURI, "rect");
      shape.setAttribute("x", String(box.x - bounds.x));
      shape.setAttribute("y", String(box.y - bounds.y + (line ? box.height * .25 : 0)));
      shape.setAttribute("width", String(box.width));
      shape.setAttribute("height", String(box.height * (line ? .5 : 1)));
      shape.setAttribute("rx", line ? "3" : "8");
      shape.setAttribute("fill", line ? "var(--color-line)" : "var(--color-panel)");
      if (!line) shape.setAttribute("stroke", "var(--color-line)");
      svg.appendChild(shape);
    };
    // Copy geometry only: no headings, text, IDs, links or live controls are duplicated.
    for (const element of real.current.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(element);
      if (parseFloat(style.borderTopWidth) > 0 || style.backgroundImage !== "none") {
        rectangle(element.getBoundingClientRect(), false);
      }
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) rectangle(box, true);
      }
    }
    snapshot.current.replaceChildren(svg);
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
