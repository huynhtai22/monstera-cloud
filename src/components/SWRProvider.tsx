"use client";

import { SWRConfig } from "swr";
import { SessionProvider } from "next-auth/react";

/**
 * P1: Global SWR configuration to prevent auth endpoint revalidation issues
 * This prevents the "Cannot destructure property 'auth' of 'e'" error
 * by ensuring SWR never tries to revalidate NextAuth's internal endpoints
 */
export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider
            refetchOnWindowFocus={false}
            refetchWhenOffline={false}
        >
            <SWRConfig
                value={{
                    // Global fetcher
                    fetcher: async (url: string) => {
                        const res = await fetch(url, { credentials: "same-origin" });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            throw new Error(data.error || "Failed to fetch");
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
        </SessionProvider>
    );
}
