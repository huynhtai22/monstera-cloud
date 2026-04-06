/**
 * Design tokens — aligns with Tailwind emerald brand + gray neutrals.
 * Use with `bg-primary`, `text-primary-foreground` via tailwind.config, or import hex for non-Tailwind contexts.
 */
export const tokens = {
  primary: {
    /** emerald-600 — main CTAs, matches sidebar-adjacent brand actions */
    DEFAULT: "#059669",
    /** emerald-700 — hover */
    hover: "#047857",
    /** emerald-500 — focus rings */
    ring: "#10b981",
    /** emerald-50 */
    muted: "#ecfdf5",
    foreground: "#ffffff",
  },
  neutral: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    500: "#6b7280",
    700: "#374151",
    900: "#111827",
  },
  radius: {
    card: "0.75rem", // rounded-xl
    control: "0.5rem", // rounded-lg
  },
  /** Shared card chrome for app panels (Tailwind class string). */
  cardClass:
    "bg-white dark:bg-slate-900/80 border border-gray-200 dark:border-slate-700 rounded-xl",
} as const;
