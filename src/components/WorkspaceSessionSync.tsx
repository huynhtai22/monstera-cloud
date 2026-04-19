"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { mutate } from "swr";
import { useWorkspaceStore } from "@/store/workspace";

const SESSION_USER_KEY = "monstera-last-auth-user-id";

/**
 * Clears persisted workspace selection when the signed-in user changes (or logs out),
 * so another account never inherits the previous user's workspace id from localStorage.
 */
export function WorkspaceSessionSync() {
    const { data: session, status } = useSession();
    const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

    useEffect(() => {
        if (typeof window === "undefined") return;

        if (status === "unauthenticated") {
            setActiveWorkspaceId(null);
            try {
                sessionStorage.removeItem(SESSION_USER_KEY);
            } catch {
                /* ignore */
            }
            return;
        }

        if (status !== "authenticated" || !session?.user?.id) return;

        const uid = session.user.id;
        let prev: string | null = null;
        try {
            prev = sessionStorage.getItem(SESSION_USER_KEY);
        } catch {
            /* ignore */
        }

        if (prev !== uid) {
            try {
                sessionStorage.setItem(SESSION_USER_KEY, uid);
            } catch {
                /* ignore */
            }
            setActiveWorkspaceId(null);
            void mutate((key) => typeof key === "string" && key.startsWith("/api/"), undefined, {
                revalidate: true,
            });
        }
    }, [status, session?.user?.id, setActiveWorkspaceId]);

    return null;
}
