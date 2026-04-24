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
                    fetcher: async (resource: any) => {
                        // SWR keys can be arrays or objects. Extract the URL string if possible.
                        const url = Array.isArray(resource) ? resource[0] : resource;
                        
                        // NextAuth internally uses SWR for its session. If we intercept it 
                        // and throw an error (or return the wrong format), it crashes React with 
                        // "Cannot destructure property 'auth' of 'e'". We bypass it completely.
                        if (typeof url === "string" && url.startsWith("/api/auth/")) {
                            const res = await fetch(url, { credentials: "same-origin" });
                            return res.json().catch(() => null);
                        }

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
        </SessionProvider>
    );
}
