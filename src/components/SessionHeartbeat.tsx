"use client";

import { useEffect } from "react";
import { signOut, useSession } from "next-auth/react";

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * P3 presence ping: keeps `UserSession.lastSeenAt` (and its IP/UA hashes)
 * fresh while the app is open so sharing signals reflect real usage.
 * Silent and best-effort — failures never surface to the user.
 */
export function SessionHeartbeat() {
    const { status } = useSession();

    useEffect(() => {
        if (status !== "authenticated") return;
        let cancelled = false;
        const ping = async () => {
            try {
                const response = await fetch("/api/auth/heartbeat", { method: "POST" });
                if (response.status !== 401) return;
                const body = await response.json().catch(() => ({}));
                if (body?.code === "SESSION_REVOKED") {
                    await signOut({ callbackUrl: "/login?reason=session-revoked" });
                }
            } catch {
                // Presence and enforcement remain fail-open on infrastructure failure.
            }
        };
        void ping();
        const timer = setInterval(() => {
            if (!cancelled && document.visibilityState === "visible") void ping();
        }, HEARTBEAT_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [status]);

    return null;
}
