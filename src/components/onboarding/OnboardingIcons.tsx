import Image from "next/image";
import { LogoMark } from "@/components/Logo";
import type { WorkCategory } from "@prisma/client";
import { logoPathForCatalogId } from "@/lib/integration-logos";
import styles from "./Onboarding.module.css";

type BusinessGlyph = WorkCategory | "coordinator" | "team" | "accounts" | "report" | "permission";

/** A shared 24px grid: squared panels, data rows and deliberate junctions. */
export function BusinessIcon({ name, size = 24, className }: { name: BusinessGlyph; size?: number; className?: string }) {
  if (name === "coordinator") return <span style={{ width: size, height: size, display: "inline-flex", flexShrink: 0 }} className={className} aria-hidden="true"><LogoMark className={styles.coordinatorMark} /></span>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {name === "BUSINESS_OWNER" && <><path d="M4 21V5h10v16M14 11h6v10M2 21h20" /><path d="M7 8h4M7 12h4M7 16h4M17 14v3" opacity=".5" /><path d="M8 21v-2h2v2" /></>}
    {name === "GROWTH_MARKETER" && <><path d="M3 4v17h18M7 17v-4M12 17V9M17 17v-6" opacity=".5" /><path d="m6 9 5-5 5 3 5-5M17 2h4v4" /></>}
    {name === "AGENCY_CONSULTANT" && <><rect x="2" y="3" width="8" height="6" rx="1" /><rect x="14" y="3" width="8" height="6" rx="1" /><rect x="8" y="16" width="8" height="6" rx="1" /><path d="M6 9v3h12V9M12 12v4" opacity=".5" /><path d="M5 6h2M17 6h2M11 19h2" /></>}
    {name === "ECOMMERCE_SELLER" && <><path d="M3 9h18l-2-6H5L3 9ZM4 9v12h16V9M9 21v-7h6v7" /><path d="M3 9c0 3 4.5 3 4.5 0 0 3 4.5 3 4.5 0 0 3 4.5 3 4.5 0 0 3 4.5 3 4.5 0" opacity=".5" /></>}
    {name === "OPERATIONS_ANALYST" && <><rect x="2" y="3" width="8" height="7" rx="1" /><rect x="14" y="14" width="8" height="7" rx="1" /><path d="M10 6h8v8M14 18H6v-8" opacity=".5" /><path d="m16 11 2 3 2-3M4 13l2-3 2 3M5 6h2M17 18h2" /></>}
    {name === "OTHER" && <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" opacity=".5" /><rect x="3" y="14" width="7" height="7" rx="1" opacity=".5" /><path d="M17.5 14v7M14 17.5h7" /></>}
    {name === "team" && <><rect x="2" y="3" width="7" height="5" rx="1" /><rect x="2" y="10" width="7" height="5" rx="1" /><rect x="2" y="17" width="7" height="5" rx="1" /><path d="M9 5.5h3v14H9M12 12.5h3" opacity=".5" /><rect x="15" y="8" width="7" height="9" rx="1" /><path d="M17 11h3M17 14h3" /></>}
    {name === "accounts" && <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20M9 9v11" opacity=".5" /><path d="M5 6.5h1M12 13h6M12 16h4M5 12v1M5 16v1" /></>}
    {name === "report" && <><path d="M5 2h10l4 4v16H5V2ZM15 2v5h4" /><path d="M8 17v-3M12 17v-6M16 17v-4M8 19h8" opacity=".5" /></>}
    {name === "permission" && <><path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5l8-3Z" opacity=".5" /><path d="M9 11V9a3 3 0 0 1 6 0v2" /><rect x="8" y="11" width="8" height="6" rx="1" /><path d="M12 13v2" /></>}
  </svg>;
}

export function SourceLogo({ provider, size = 20 }: { provider: string; size?: number }) {
  return <Image src={logoPathForCatalogId(provider)} alt="" width={size} height={size} className={styles.sourceLogo} unoptimized aria-hidden="true" />;
}
