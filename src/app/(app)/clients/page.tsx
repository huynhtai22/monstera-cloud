import { Suspense } from "react";
import { ClientsClient } from "./ClientsClient";
import { PageShell } from "@/components/ui/PageShell";

/**
 * Server Component shell so `useSearchParams` inside ClientsClient is behind Suspense
 * (required for static generation / Vercel build).
 */
export default function ClientsPage() {
    return (
        <Suspense
            fallback={
                <PageShell>
                    <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading clients…</div>
                </PageShell>
            }
        >
            <ClientsClient />
        </Suspense>
    );
}
