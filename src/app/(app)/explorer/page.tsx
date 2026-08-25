import { PageShell } from "@/components/ui/PageShell";
import { WarehouseWorkbench } from "@/components/data-explorer/WarehouseWorkbench";

export default function DataExplorerPage() {
    return (
        <PageShell className="w-full" withBackdrop>
            <WarehouseWorkbench />
        </PageShell>
    );
}
