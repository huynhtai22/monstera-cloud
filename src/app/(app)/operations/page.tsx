import { Suspense } from "react";
import { OperationsClient } from "./OperationsClient";
import { PageShell } from "@/components/ui/PageShell";

/**
 * Server Component shell so `useSearchParams` inside OperationsClient is behind
 * Suspense (required for static generation / Vercel build).
 */
export default function OperationsPage() {
    return (
        <Suspense
            fallback={
                <PageShell>
                    <div className="py-16 text-center text-sm text-ink-mute">Loading operations…</div>
                </PageShell>
            }
        >
            <OperationsClient />
        </Suspense>
    );
}
