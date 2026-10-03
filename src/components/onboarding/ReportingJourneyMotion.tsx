"use client";

import type { CSSProperties } from "react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { logoPathForCatalogId } from "@/lib/integration-logos";
import styles from "./ReportingJourneyMotion.module.css";

export type JourneyVisual = { step: "connect"; provider: string; logoSrc?: string; running?: boolean };

function Grid({ active = false }: { active?: boolean }) {
  return <span className={`${styles.grid} ${active ? styles.active : ""}`} aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--dot": index } as CSSProperties} />)}</span>;
}

/** Decorative motion mirrors supplied evidence; this component performs no work. */
export function ReportingJourneyMotion({ visual, compact = false }: { visual: JourneyVisual; compact?: boolean }) {
  return <div className={`${styles.root} ${compact ? styles.compact : ""}`} data-journey-step={visual.step}>
    {visual.step === "connect" && <div className={styles.connection} aria-hidden="true">
      <span className={styles.source}><IntegrationMark src={visual.logoSrc ?? logoPathForCatalogId(visual.provider)} size="lg" /></span>
      <span className={`${styles.bridge} ${visual.running ? styles.flowing : ""}`}><i /></span>
      <span className={styles.tile}><Grid active={visual.running} /></span>
    </div>}

  </div>;
}
