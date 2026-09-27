import { cn } from "@/lib/utils";

type ConsoleActivityLabelProps = {
  label: string;
  className?: string;
};

/** A compact in-progress cue for console work, based on the recorded dot grid and text shimmer. */
export function ConsoleActivityLabel({ label, className }: ConsoleActivityLabelProps) {
  return (
    <span className={cn("console-activity-label", className)}>
      <span className="console-activity-dots" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
      </span>
      <span className="console-activity-text">{label}</span>
    </span>
  );
}
