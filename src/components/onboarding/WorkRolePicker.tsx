"use client";
import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { BusinessIcon } from "./OnboardingIcons";
import type { WorkCategory } from "@prisma/client";
import { WORK_ROLES } from "@/lib/agent/catalog";
import styles from "./Onboarding.module.css";

export function WorkRolePicker({ category, onChange, busy, onContinue, onSkip }: {
  category: WorkCategory | null; onChange: (category: WorkCategory) => void; busy: boolean; onContinue: () => void; onSkip: () => void;
}) {
  return <section className={styles.welcome} aria-labelledby="role-title">
    <p className={styles.eyebrow}>A LITTLE ABOUT YOU</p>
    <h1 id="role-title" tabIndex={-1}>Which best describes your work?</h1>
    <p className={styles.muted}>Let’s shape your workspace around what matters to you.</p>
    <div className={styles.roles} role="group" aria-label="Your work">
      {WORK_ROLES.map((role, index) => { return <button key={role.id} className={styles.role} style={{ "--role-index": index } as CSSProperties} aria-pressed={category === role.id} disabled={busy} onClick={() => onChange(role.id)}>
        {category === role.id && <Check className={styles.selectedMark} size={15} aria-hidden="true" />}
        <span className={styles.roleIcon}><BusinessIcon name={role.id} size={28} /></span><strong>{role.name}</strong><span>{role.description}</span>
      </button>; })}
    </div>
    <button className={styles.primary} disabled={!category || busy} onClick={onContinue}>{busy ? "Saving…" : "Continue"}<span aria-hidden="true">→</span></button>
    <button className={styles.textButton} onClick={onSkip} disabled={busy}>I’ll tell you later</button>
    <p className={styles.small}>You can change this later. Your role only personalizes your experience.</p>
  </section>;
}
