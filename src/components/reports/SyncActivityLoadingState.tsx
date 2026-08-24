const SUMMARY_PLACEHOLDERS = Array.from({ length: 4 });
const ROW_PLACEHOLDERS = Array.from({ length: 5 });

function Pulse({ className }: { className: string }) {
    return (
        <span
            aria-hidden="true"
            className={`block rounded bg-white/[0.07] motion-safe:animate-pulse motion-reduce:animate-none ${className}`}
        />
    );
}

export function SyncActivityTableSkeleton() {
    return (
        <div role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">Loading sync activity…</span>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {SUMMARY_PLACEHOLDERS.map((_, index) => (
                    <div key={index} className="rounded-md border border-line bg-canvas px-4 py-3">
                        <Pulse className="mb-2 h-2.5 w-16" />
                        <Pulse className="h-4 w-24" />
                    </div>
                ))}
            </div>
            <div className="overflow-x-auto rounded-md border border-line">
                <div className="min-w-[38rem]">
                    <div className="grid grid-cols-[minmax(9rem,2fr)_1fr_0.7fr_1fr] gap-4 border-b border-line bg-canvas px-4 py-3">
                        {SUMMARY_PLACEHOLDERS.map((_, index) => (
                            <Pulse key={index} className="h-2.5 w-16" />
                        ))}
                    </div>
                    {ROW_PLACEHOLDERS.map((_, index) => (
                        <div
                            key={index}
                            className="grid grid-cols-[minmax(9rem,2fr)_1fr_0.7fr_1fr] gap-4 border-b border-line px-4 py-4 last:border-b-0"
                        >
                            <Pulse className="h-3 w-32" />
                            <Pulse className="h-3 w-16" />
                            <Pulse className="h-3 w-10" />
                            <Pulse className="h-3 w-24" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function SyncActivityPageSkeleton() {
    return (
        <div role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">Loading sync activity page…</span>
            <div className="mb-5">
                <Pulse className="mb-3 h-6 w-40" />
                <Pulse className="mb-5 h-3 w-80 max-w-full" />
                <div className="flex flex-wrap gap-2">
                    {SUMMARY_PLACEHOLDERS.map((_, index) => (
                        <Pulse key={index} className="h-7 w-20" />
                    ))}
                </div>
            </div>
            <div className="rounded-lg border border-line bg-panel p-5">
                <Pulse className="mb-2 h-4 w-24" />
                <Pulse className="mb-6 h-3 w-64 max-w-full" />
                <SyncActivityTableSkeleton />
            </div>
        </div>
    );
}
