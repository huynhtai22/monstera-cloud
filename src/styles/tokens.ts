/**
 * Dark-first product tokens (Vercel / Palantir-adjacent).
 * Tailwind utilities: bg-canvas, bg-panel, border-line, text-ink, text-ink-mute, text-accent.
 */
export const tokens = {
  canvas: "#050505",
  panel: "#0c0c0c",
  line: "#222222",
  ink: "#ededed",
  inkMute: "#8a8a8a",
  accent: "#67e8f9",
  primary: {
    DEFAULT: "#e8e8e8",
    hover: "#ffffff",
    ring: "#a3a3a3",
    muted: "#141414",
    foreground: "#050505",
  },
  radius: {
    card: "0.5rem",
    control: "0.375rem",
  },
  cardClass:
    "bg-panel border border-line rounded-lg",
} as const;
