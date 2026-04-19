"use client";

import { useEffect, useMemo } from "react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to fetch data");
    return data;
};

/**
 * Resolves the active workspace against `/api/workspaces` so we never call APIs with
 * another user's persisted `activeWorkspaceId` (localStorage) after account switch.
 */
export function useResolvedWorkspaceId() {
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

    const { data: workspaces, error, isLoading } = useSWR("/api/workspaces", fetcher);

    const resolvedId = useMemo(() => {
        if (!Array.isArray(workspaces) || workspaces.length === 0) return null;
        if (activeWorkspaceId && workspaces.some((w: { id: string }) => w.id === activeWorkspaceId)) {
            return activeWorkspaceId;
        }
        return (workspaces[0] as { id: string }).id;
    }, [workspaces, activeWorkspaceId]);

    useEffect(() => {
        if (resolvedId && resolvedId !== activeWorkspaceId) {
            setActiveWorkspaceId(resolvedId);
        }
    }, [resolvedId, activeWorkspaceId, setActiveWorkspaceId]);

    return {
        workspaceId: resolvedId,
        workspaces,
        error,
        isLoading,
    };
}
