"use client";

import { useId, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Circle,
  LoaderCircle,
  Pause,
} from "lucide-react";
import styles from "./delegation.module.css";

export type TaskCardStatus =
  "waiting" | "running" | "complete" | "attention" | "paused";

/** Native task disclosure. Only a real running state animates activity. */
export function MonsteraTaskCard({
  title,
  label,
  status,
  icon,
  children,
}: {
  title: string;
  label: string;
  status: TaskCardStatus;
  icon: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const StatusIcon =
    status === "running"
      ? LoaderCircle
      : status === "complete"
        ? Check
        : status === "attention"
          ? CircleAlert
          : status === "paused"
            ? Pause
            : Circle;
  return (
    <article className={styles.task} data-task-status={status}>
      <button
        type="button"
        className={styles.taskToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.provider} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.taskTitle}>
          <strong>{title}</strong>
          <span aria-live="polite">{label}</span>
        </span>
        <span className={styles.statusIcon} aria-hidden="true">
          <StatusIcon size={17} />
        </span>
        <ChevronDown size={15} className={styles.chevron} aria-hidden="true" />
      </button>
      <div
        id={panelId}
        className={styles.disclosure}
        data-open={open}
        inert={!open}
        aria-hidden={!open}
      >
        <div>
          <div className={styles.taskBody}>{children}</div>
        </div>
      </div>
    </article>
  );
}
