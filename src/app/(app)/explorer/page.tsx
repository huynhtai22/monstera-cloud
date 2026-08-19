import { PageShell } from "@/components/ui/PageShell";
import { WarehouseWorkbench } from "@/components/data-explorer/WarehouseWorkbench";

export default function DataExplorerPage() {
    return (
        <PageShell className="max-w-7xl">
            <div className="mb-5">
                <h1 className="text-xl font-semibold tracking-tight text-ink">Warehouse</h1>
                <p className="mt-1 max-w-2xl text-sm text-ink-mute">
                    Unified performance data across your connected sources.
                </p>
            </div>
            <WarehouseWorkbench />
        </PageShell>
    );
}
