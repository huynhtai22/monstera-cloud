"use client";

import { useWorkspaceStore } from "@/store/workspace";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { agentRequest, AgentRequestError } from "@/hooks/use-agent-run";

async function availability(url: string) {
  try { await agentRequest(url); return true; }
  catch (error) {
    if (error instanceof AgentRequestError && error.code === "not_found") return false;
    throw error;
  }
}

export function WorkspaceSetupEntry({ workspaceId, role }: { workspaceId: string; role: string }) {
  const pathname = usePathname();
  const prefix = pathname?.match(/^\/agencies\/[^/]+/)?.[0] ?? "";
  const { data: enabled, error, isLoading } = useSWR(workspaceId ? `/api/agent/onboarding-entry?workspaceId=${encodeURIComponent(workspaceId)}` : null, availability);
  const viewer = role === "viewer";
  return <section className="rounded-lg border border-line bg-canvas p-6" aria-labelledby="workspace-setup-heading">
    <h4 id="workspace-setup-heading" className="font-medium text-ink">Workspace setup</h4>
    <p className="mt-2 text-sm text-ink-mute">Return to saved setup, review source connections, or add another source. Completed setup history stays available.</p>
    {isLoading ? <p className="mt-3 text-sm text-ink-mute" role="status">Checking setup availability…</p>
      : error ? <p className="mt-3 text-sm text-ink-mute" role="status">Setup availability could not be checked. You can still manage existing sources below.</p>
      : enabled ? <Link className="mt-4 inline-block text-sm text-ink underline underline-offset-4" href={`${prefix}/onboarding?workspaceId=${encodeURIComponent(workspaceId)}`}>{viewer ? "View workspace setup →" : "Open workspace setup →"}</Link>
      : <p className="mt-3 text-sm text-ink-mute">Guided setup is rolling out gradually. Source management is available now.</p>}
    {viewer && <p className="mt-2 text-sm text-ink-mute">A workspace member must authorize connections and change setup.</p>}
    <Link className="mt-3 block text-sm text-ink-mute underline underline-offset-4" onClick={() => useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId)} href={`${prefix}/sources`}>Manage sources →</Link>
  </section>;
}
