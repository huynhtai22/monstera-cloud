"use client";

import { SWRConfig } from "swr";
import { SessionContext, SessionProvider } from "next-auth/react";
import { usePathname } from "next/navigation";

const consolePreviewSession = {
    user: {
        id: "production-console-preview",
        name: "Alex Morgan",
        email: "preview@example.test",
    },
    expires: "2099-01-01T00:00:00.000Z",
};

/**
 * P1: Global SWR configuration to prevent auth endpoint revalidation issues
 * This prevents the "Cannot destructure property 'auth' of 'e'" error
 * by ensuring SWR never tries to revalidate NextAuth's internal endpoints
 */
export function Providers({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isReadOnlyConsolePreview = pathname?.startsWith("/demo/ui/console-structure") ?? false;
    const swrContent = (
        <SWRConfig
            value={{
                // Global fetcher
                fetcher: async (resource: any) => {
                    // SWR keys can be arrays or objects. Extract the URL string if possible.
                    const url = Array.isArray(resource) ? resource[0] : resource;

                    if (typeof url !== "string") {
                        throw new Error("Invalid SWR key format");
                    }

                    const res = await fetch(url, { credentials: "same-origin" });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        throw new Error(data?.error || "Failed to fetch");
                    }
                    return data;
                },
                // Prevent revalidation of auth endpoints
                onError: (err, key) => {
                    // Don't report auth endpoint errors - they're expected during session init
                    if (typeof key === "string" && key.includes("/api/auth/")) {
                        return;
                    }
                    console.error("[SWR Error]", key, err);
                },
                // Default options
                revalidateOnFocus: false,
                revalidateOnReconnect: true,
                dedupingInterval: 2000,
                errorRetryCount: 3,
            }}
        >
            {children}
        </SWRConfig>
    );

    if (isReadOnlyConsolePreview) {
        return (
            <SessionContext.Provider value={{ data: consolePreviewSession, status: "authenticated", update: async () => consolePreviewSession }}>
                {swrContent}
            </SessionContext.Provider>
        );
    }
    return (
        <SessionProvider
            refetchOnWindowFocus={false}
            refetchWhenOffline={false}
        >
            {swrContent}
        </SessionProvider>
    );
}
