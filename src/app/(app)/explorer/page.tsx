import { Suspense } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { WarehouseWorkbench } from "@/components/data-explorer/WarehouseWorkbench";

export default function DataExplorerPage() {
    return (
        <PageShell className="w-full" withBackdrop>
            <Suspense fallback={<div className="p-8 text-center text-xs text-ink-mute">Loading warehouse...</div>}>
                <WarehouseWorkbench />
            </Suspense>
        </PageShell>
    );
}
