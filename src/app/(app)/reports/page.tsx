import { Suspense } from "react";
import { ReportsClient } from "./ReportsClient";
import { PageShell } from "@/components/ui/PageShell";
import { SyncActivityPageSkeleton } from "@/components/reports/SyncActivityLoadingState";

/**
 * Server Component shell so `useSearchParams` inside ReportsClient is behind Suspense
 * (required for static generation / Vercel build).
 */
export default function ReportsPage() {
    return (
        <Suspense
            fallback={
                <PageShell>
                    <SyncActivityPageSkeleton />
                </PageShell>
            }
        >
            <ReportsClient />
        </Suspense>
    );
}
