import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./ConsoleSyncLabel.module.css";

type ConsoleSyncLabelProps = {
  active: boolean;
  idleLabel: string;
  activeLabel: string;
  idleIcon?: ReactNode;
  className?: string;
  iconOnly?: boolean;
};

/** Keep both states mounted so direction changes dissolve smoothly without moving the label. */
export function ConsoleSyncLabel({
  active,
  idleLabel,
  activeLabel,
  idleIcon = <RefreshCw size={14} />,
  className,
  iconOnly = false,
}: ConsoleSyncLabelProps) {
  return (
    <span
      className={cn(styles.root, iconOnly && styles.iconOnly, className)}
      data-busy={active}
    >
      <span className="sr-only">{active ? activeLabel : idleLabel}</span>
      <span className={styles.symbol} aria-hidden="true">
        <span className={styles.idleIcon}>{idleIcon}</span>
        <span className={styles.dotStage}>
          <span className={styles.dots}>
            {Array.from({ length: 9 }, (_, index) => (
              <span key={index} />
            ))}
          </span>
        </span>
      </span>
      {!iconOnly && (
        <span className={styles.labels} aria-hidden="true">
          <span className={styles.idleText}>{idleLabel}</span>
          <span className={styles.busyText}>
            {activeLabel}
          </span>
        </span>
      )}
    </span>
  );
}
