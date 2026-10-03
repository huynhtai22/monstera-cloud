"use client";

import type { CSSProperties } from "react";
import { Check, Database, FileCheck2, Users } from "lucide-react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { logoPathForCatalogId } from "@/lib/integration-logos";
import styles from "./ReportingJourneyMotion.module.css";
import { importItemProgress } from "./journey-evidence";

export type JourneyVisual =
  | { step: "connect"; provider: string; logoSrc?: string; running?: boolean }
  | { step: "scope"; accounts: { id: string; name: string }[]; groupLabel: string }
  | { step: "import"; running: boolean; status: string; completed: number | null; total: number | null; since: string; until: string }
  | { step: "output"; destination: string; inspectedLabel?: string; inspected: boolean; rows: number; since: string; until: string };

function Grid({ active = false }: { active?: boolean }) {
  return <span className={`${styles.grid} ${active ? styles.active : ""}`} aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--dot": index } as CSSProperties} />)}</span>;
}

/** Decorative motion mirrors supplied evidence; this component performs no work. */
export function ReportingJourneyMotion({ visual, compact = false }: { visual: JourneyVisual; compact?: boolean }) {
  const progress = visual.step === "import" ? importItemProgress(visual.completed, visual.total) : null;
  return <div className={`${styles.root} ${compact ? styles.compact : ""}`} data-journey-step={visual.step}>
    {visual.step === "connect" && <div className={styles.connection} aria-hidden="true">
      <span className={styles.source}><IntegrationMark src={visual.logoSrc ?? logoPathForCatalogId(visual.provider)} size="lg" /></span>
      <span className={`${styles.bridge} ${visual.running ? styles.flowing : ""}`}><i /></span>
      <span className={styles.tile}><Grid active={visual.running} /></span>
    </div>}
    {visual.step === "scope" && <>
      <div className={styles.group}><Users size={16} aria-hidden /><strong>{visual.groupLabel}</strong><span>{visual.accounts.length} selected</span></div>
      <div className={styles.accounts}>{visual.accounts.slice(0, 3).map(account => <span key={account.id} className={styles.account}><Check size={13} aria-hidden />{account.name}</span>)}{visual.accounts.length > 3 && <span className={styles.account}>+{visual.accounts.length - 3} more</span>}{!visual.accounts.length && <span className={styles.muted}>Choose accounts below to define this group.</span>}</div>
    </>}
    {visual.step === "import" && <>
      <div className={styles.importRow}><Grid active={visual.running} /><div><strong>{visual.status}</strong><span>{visual.since} — {visual.until}</span></div><Database size={21} aria-hidden /></div>
      <p>{progress ? `${progress.completed} of ${progress.total} account imports completed` : "Waiting for import evidence"}</p>
      {progress && <progress aria-label="Completed account imports" max={progress.total} value={progress.completed} />}
    </>}
    {visual.step === "output" && <div className={`${styles.output} ${visual.inspected ? styles.inspected : ""}`}>
      <span className={styles.outputIcon}>{visual.inspected ? <FileCheck2 size={23} aria-hidden /> : <Database size={23} aria-hidden />}</span>
      <div><strong>{visual.destination}</strong><span>{visual.rows.toLocaleString()} rows · {visual.since} — {visual.until}</span><span className={visual.inspected ? styles.checked : styles.muted}>{visual.inspected ? (visual.inspectedLabel ?? "Output reviewed") : "Inspect the output before confirming"}</span></div>
    </div>}
  </div>;
}
