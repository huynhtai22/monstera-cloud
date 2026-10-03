"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useClientContextNavigation } from "@/components/client-context/useClientContextNavigation";
import { useWorkspaceStartup } from "@/components/WorkspaceStartup";
import { FeatureReminder, type FeatureHighlight } from "./FeatureReminder";

function quietConsole() {
  const active = document.activeElement;
  return document.visibilityState === "visible" && !document.querySelector('[role="dialog"], [aria-modal="true"], [role="alert"]') && !(active instanceof HTMLElement && (active.matches("input,textarea,select") || active.isContentEditable));
}

/** Mounted only on a successfully loaded, healthy production dashboard. */
export function AutomaticFeatureReminder({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const { data: session, status } = useSession();
  const startup = useWorkspaceStartup();
  const { hrefFor } = useClientContextNavigation();
  const [campaign, setCampaign] = useState<{ id: string; highlights: readonly FeatureHighlight[] } | null>(null);
  const handoff = startup?.handoff ?? true;
  useEffect(() => {
    if (!enabled || !handoff || status !== "authenticated" || !session?.user?.id || !workspaceId) return;
    let cancelled = false, requesting = false;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (requesting || !quietConsole()) return;
      requesting = true;
      void fetch("/api/user/feature-reminder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }), signal: controller.signal }).then(async response => {
        const data = response.ok ? await response.json() : null;
        if (!cancelled && quietConsole() && data?.campaign) setCampaign(data.campaign);
      }).catch(() => {}).finally(() => clearInterval(timer));
    }, 1500);
    return () => { cancelled = true; clearInterval(timer); controller.abort(); setCampaign(null); };
  }, [enabled, handoff, status, session?.user?.id, workspaceId]);
  return <FeatureReminder open={Boolean(campaign) && enabled} highlights={campaign?.highlights} onClose={() => setCampaign(null)} hrefFor={hrefFor} />;
}
