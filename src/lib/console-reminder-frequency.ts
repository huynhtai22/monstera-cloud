import type { ReminderCampaign } from "./console-feature-campaigns";

export const REMINDER_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
export type ReminderExposure = { campaignId: string; sessionHash: string; shownAt: string };

export function reminderHistory(value: unknown): ReminderExposure[] {
  if (value == null) return [];
  // Corrupt state must suppress automatic messages rather than reset their frequency.
  if (!Array.isArray(value) || value.some(row => !row || typeof row.campaignId !== "string" || typeof row.sessionHash !== "string" || typeof row.shownAt !== "string" || !Number.isFinite(Date.parse(row.shownAt)))) throw new Error("Invalid reminder history");
  return value;
}

export function selectReminder(input: { campaigns: readonly ReminderCampaign[]; history: readonly ReminderExposure[]; sessionHash: string; now: Date; role: string; plan: string; setupReady: boolean }) {
  const { campaigns, history, sessionHash, now, role, plan, setupReady } = input;
  if (!setupReady || !sessionHash) return null;
  if (history.some(row => row.sessionHash === sessionHash || now.getTime() - Date.parse(row.shownAt) < REMINDER_COOLDOWN_MS)) return null;
  return campaigns.find(campaign =>
    !history.some(row => row.campaignId === campaign.id) &&
    (!campaign.roles || campaign.roles.includes(role)) &&
    (!campaign.plans || campaign.plans.includes(plan)) &&
    (!campaign.startsAt || Date.parse(campaign.startsAt) <= now.getTime()) &&
    (!campaign.endsAt || Date.parse(campaign.endsAt) > now.getTime()) &&
    // Announcements must explicitly declare who can use the feature.
    (campaign.kind === "introduction" || Boolean(campaign.roles?.length && campaign.plans?.length && campaign.startsAt && campaign.endsAt))
  ) ?? null;
}

export function reminderSetupReady(profileAnswered: boolean, role: string, latestRun: { status: string; reviewedAt: Date | null } | null, hasStoredData: boolean) {
  if (latestRun) return latestRun.status === "completed" && latestRun.reviewedAt !== null;
  return role === "viewer" || profileAnswered || hasStoredData;
}
