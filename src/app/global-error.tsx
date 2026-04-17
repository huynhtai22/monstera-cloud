"use client";

import { useEffect } from "react";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Chunk load errors happen when the browser has stale cached HTML pointing
        // at old JS bundles after a new deployment. Auto-reload once to recover.
        if (
            error?.name === "ChunkLoadError" ||
            error?.message?.includes("Loading chunk") ||
            error?.message?.includes("Failed to fetch dynamically imported module")
        ) {
            window.location.reload();
        }
    }, [error]);

    return (
        <html lang="en">
            <body style={{ margin: 0, fontFamily: "sans-serif", background: "#f8fafc" }}>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: "100vh",
                        padding: "2rem",
                        textAlign: "center",
                    }}
                >
                    <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a", marginBottom: "0.5rem" }}>
                        Something went wrong
                    </h2>
                    <p style={{ color: "#64748b", marginBottom: "1.5rem", maxWidth: "400px" }}>
                        {error?.message || "An unexpected error occurred. Try refreshing the page."}
                    </p>
                    <button
                        onClick={reset}
                        style={{
                            background: "#0891b2",
                            color: "#fff",
                            border: "none",
                            borderRadius: "8px",
                            padding: "0.6rem 1.5rem",
                            fontWeight: 600,
                            cursor: "pointer",
                        }}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
