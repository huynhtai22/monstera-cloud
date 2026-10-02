"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRunStatus, AgentTaskState } from "@prisma/client";
import type { z } from "zod";
import type { OfferedScopeSchema, ConfirmedScopeSchema } from "@/lib/agent/execution-contracts";
import type { ProposalSchema } from "@/lib/agent/tools";

export type AgentSnapshot = {
  run: { id: string; workspaceId: string; clientId: string | null; version: number; status: AgentRunStatus; goal?: { id: string; context: string } | null };
  tasks: { id: string; provider: string; state: AgentTaskState; scopeRevision: number; version: number; reasonCode: string | null; requestedScope: z.infer<typeof OfferedScopeSchema> | null; confirmedScope: z.infer<typeof ConfirmedScopeSchema> | null; importJobId: string | null; result: { retryRemaining?: number; verified: boolean; rowsCount: number; completedItems: number; totalItems: number } | null }[];
  messages: { id: string; role: string; content: string; structuredResponse: { proposedActions?: z.infer<typeof ProposalSchema>[] } | null }[];
  events: { id: string; sequence: number; taskId: string | null; type: string }[];
  nextSequence: number; lastSequence: number; hasMoreEvents: boolean;
};
export class AgentRequestError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}
export async function agentRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AgentRequestError(data.message || "Unable to save setup. Please try again.", data.code || "request_failed", response.status);
  return data;
}

export function useAgentRun(runId: string | null) {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTaskIds, setNewTaskIds] = useState<string[]>([]);
  const current = useRef<AgentSnapshot | null>(null);
  const generation = useRef(0);
  const refreshing = useRef(false);
  const cursor = useRef(0);
  const initialized = useRef(false);
  const refresh = useCallback(async () => {
    if (!runId) return;
    const epoch = generation.current;
    // A mutation needs a fresh read after any earlier poll finishes; dropping
    // that refresh would leave controls using an older optimistic version.
    while (refreshing.current) {
      await new Promise(resolve => setTimeout(resolve, 20));
      if (epoch !== generation.current) return;
    }
    refreshing.current = true;
    try {
      let more = true;
      while (more) {
        const next = await agentRequest<AgentSnapshot>(`/api/agent/runs/${runId}?afterSequence=${cursor.current}`);
        if (epoch !== generation.current) return;
        if (initialized.current) setNewTaskIds(next.events.filter(e => e.taskId).map(e => e.taskId!));
        initialized.current = true;
        cursor.current = next.nextSequence;
        current.current = next;
        setSnapshot(next); setError(null);
        more = next.hasMoreEvents;
      }
    } catch (err) { if (epoch === generation.current) setError(err instanceof Error ? err.message : "Unable to load setup"); }
    finally { if (epoch === generation.current) refreshing.current = false; }
  }, [runId]);

  useEffect(() => {
    const epoch = ++generation.current;
    refreshing.current = false; cursor.current = 0; initialized.current = false; current.current = null;
    setSnapshot(null); setNewTaskIds([]); setError(null);
    void refresh();
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      if (!live) return;
      const active = current.current?.tasks.some(t => ["queued", "importing", "verifying", "discovering_accounts"].includes(t.state) || (t.state === "needs_attention" && ["lease_lost_or_stalled", "import_needs_review"].includes(t.reasonCode ?? "")));
      timer = setTimeout(async () => { if (!document.hidden && !["completed", "paused"].includes(current.current?.run.status ?? "")) await refresh(); poll(); }, active ? 2000 : 10000);
    };
    poll();
    const focus = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", focus); window.addEventListener("focus", focus);
    return () => { live = false; generation.current = epoch + 1; clearTimeout(timer); document.removeEventListener("visibilitychange", focus); window.removeEventListener("focus", focus); };
  }, [refresh]);
  return { snapshot, error, refresh, newTaskIds };
}
