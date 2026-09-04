"use client";

import { useState } from "react";
import { SWRConfig } from "swr";
import { BillingTab } from "@/components/settings/BillingTab";

const fixture = { plan: "professional", status: "PILOT", subscriptionEndsAt: "2026-09-11T00:00:00.000Z", subscriptionProvider: null, usage: { connectionsCount: 3, membersCount: 2, pipelinesCount: 0 }, orders: [] };

export function BillingPreview() {
  const [scenario, setScenario] = useState("trial");
  const data = { ...fixture, status: scenario === "trial" ? "PILOT" : "ACTIVE", plan: scenario === "free" ? "free" : scenario === "legacy" ? "starter" : "professional", subscriptionEndsAt: ["free", "legacy"].includes(scenario) ? null : fixture.subscriptionEndsAt, subscriptionProvider: scenario === "paid" ? "vietqr_domestic" : null };
  return <main className="min-h-screen bg-canvas px-5 py-10 text-ink"><div className="mx-auto mb-8 max-w-4xl rounded-xl border border-line p-4 text-xs text-ink-mute"><p>Development preview · synthetic data only. Do not submit a payment from this fixture.</p><label className="mt-3 flex items-center gap-3">Scenario<select className="rounded border border-line bg-panel p-2" value={scenario} onChange={event => setScenario(event.target.value)}>{["trial", "paid", "free", "legacy", "viewer"].map(value => <option key={value}>{value}</option>)}</select></label></div><SWRConfig key={scenario} value={{ provider: () => new Map(), fallback: { "/api/workspaces/billing-preview/billing": data }, isPaused: () => true }}><BillingTab key={scenario} workspacePlan={data.plan} workspaceStatus={data.status} subscriptionEndsAt={data.subscriptionEndsAt} workspaceId="billing-preview" isOwner={scenario !== "viewer"} /></SWRConfig></main>;
}
