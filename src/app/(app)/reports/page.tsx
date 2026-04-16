import { Suspense } from "react";
import { ReportsClient } from "./ReportsClient";
import { PageShell } from "@/components/ui/PageShell";

/**
 * Server Component shell so `useSearchParams` inside ReportsClient is behind Suspense
 * (required for static generation / Vercel build).
 */
export default function ReportsPage() {
    return (
        <Suspense
            fallback={
                <PageShell>
                    <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading reports…</div>
                </PageShell>
            }
        >
            <ReportsClient />
        </Suspense>
    );
}
