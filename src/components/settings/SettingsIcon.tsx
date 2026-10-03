import type { SVGProps } from "react";

export type SettingsIconName = "overview" | "workspace" | "clients" | "team" | "alerts" | "billing" | "api" | "sessions" | "appearance" | "search" | "arrow";

/** One optical grid and stroke weight across the Settings family. */
export function SettingsIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: SettingsIconName }) {
  const paths: Record<SettingsIconName, React.ReactNode> = {
    overview: <><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="14" y="4" width="6" height="11" rx="2"/><rect x="4" y="14" width="7" height="6" rx="2"/><path d="M14 19h6"/></>,
    workspace: <><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M9 5V3h6v2M4 11h16M9 15h6"/></>,
    clients: <><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v3h4v-3"/></>,
    team: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/></>,
    alerts: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3ZM10 20h4"/><path d="M19 4l2-1M20 8h2"/></>,
    billing: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3M14 15h3"/></>,
    api: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/></>,
    sessions: <><rect x="3" y="4" width="15" height="12" rx="2"/><path d="M7 20h7M10 16v4"/><rect x="16" y="11" width="5" height="10" rx="1.5"/></>,
    appearance: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M9 9v11"/><circle cx="16" cy="14.5" r="2.5"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
