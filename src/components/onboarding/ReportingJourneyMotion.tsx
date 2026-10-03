"use client";

import { LogoMark } from "@/components/Logo";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { logoPathForCatalogId } from "@/lib/integration-logos";
import styles from "./ReportingJourneyMotion.module.css";

export type JourneyVisual = { step: "connect"; provider: string; logoSrc?: string; running?: boolean };

/** Decorative motion mirrors supplied evidence; this component performs no work. */
export function ReportingJourneyMotion({ visual, compact = false }: { visual: JourneyVisual; compact?: boolean }) {
  return <div className={`${styles.root} ${compact ? styles.compact : ""}`} data-journey-step={visual.step}>
    {visual.step === "connect" && <div className={styles.connection} aria-hidden="true">
      <span className={styles.source}><IntegrationMark src={visual.logoSrc ?? logoPathForCatalogId(visual.provider)} size="lg" /></span>
      <span className={`${styles.bridge} ${visual.running ? styles.flowing : ""}`}><i /></span>
      <span className={styles.tile}><LogoMark className={styles.mark} /></span>
    </div>}

  </div>;
}
