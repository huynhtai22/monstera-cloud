import type { ReactNode } from "react";

/** Full-screen setup retains root providers without the console sidebar. */
export default function OnboardingLayout({ children }: { children: ReactNode }) { return children; }
