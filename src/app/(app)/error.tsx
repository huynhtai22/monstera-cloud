"use client";

import { useEffect } from "react";

export default function AppError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Auto-reload on stale chunk errors caused by new deployments
        if (
            error?.name === "ChunkLoadError" ||
            error?.message?.includes("Loading chunk") ||
            error?.message?.includes("Failed to fetch dynamically imported module")
        ) {
            window.location.reload();
        }
        console.error("[AppError]", error);
    }, [error]);

    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md">
                {error?.message || "An unexpected error occurred. Try refreshing the page."}
            </p>
            <button
                onClick={reset}
                className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-neutral-200 transition-colors shadow-xs"
            >
                Try again
            </button>
        </div>
    );
}
