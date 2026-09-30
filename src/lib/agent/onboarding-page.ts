import { notFound, redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { isProviderConfigured } from "@/lib/oauth-framework/registry";
import { isConnectEnabled } from "@/lib/integration-flags";
import { ProviderSchema } from "./contracts";
import { isAgentWorkspaceEnabled } from "./rollout";

export async function onboardingPageData(agencySlug?: string, requestedWorkspaceId?: string) {
  if (process.env.ENABLE_AGENT_ONBOARDING !== "1") notFound();
  if (agencySlug && process.env.AGENCY_HOST_ROUTING_ENABLED !== "1") notFound();
  const session = await getAuthSession();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fonboarding");
  const userId = session.user.id;
  const [profile, memberships] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { workCategory: true, workProfileAnsweredAt: true } }),
    prisma.workspaceMember.findMany({ where: { userId, ...(agencySlug ? { workspace: { slug: agencySlug } } : {}) }, orderBy: { workspace: { createdAt: "asc" } },
      select: { role: true, workspace: { select: { id: true, name: true, slug: true } } } }),
  ]);
  const pilotMemberships = memberships.filter(({ workspace }) => isAgentWorkspaceEnabled(workspace.id));
  if (!pilotMemberships.length) notFound();
  const workspaces = await Promise.all(pilotMemberships.map(async ({ role, workspace }) => {
    const [clients, access, run] = await Promise.all([
      prisma.client.findMany({ where: { workspaceId: workspace.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.workspaceProviderAccess.findMany({ where: { workspaceId: workspace.id, enabled: true }, select: { provider: true } }),
      prisma.agentRun.findFirst({ where: { workspaceId: workspace.id, initiatorUserId: userId, kind: "onboarding" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, clientId: true, status: true } }),
    ]);
    return { ...workspace, role, clients, run, enabledProviders: access.map(row => row.provider).filter(id => ProviderSchema.safeParse(id).success && isConnectEnabled(id)) };
  }));
  const selectedWorkspaceId = workspaces.find(w => w.id === requestedWorkspaceId)?.id ?? workspaces[0]?.id ?? null;
  return { profile: { category: profile.workCategory, answered: Boolean(profile.workProfileAnsweredAt) }, workspaces, selectedWorkspaceId, agencySlug: agencySlug ?? null, canAuthorizeTikTok: isProviderConfigured("tiktok_business"), canAuthorizeMeta: isProviderConfigured("meta_ads"), canAuthorizeGoogle: isProviderConfigured("google_ads"), canAuthorizeShopee: isProviderConfigured("shopee") };
}
export type OnboardingBoot = Awaited<ReturnType<typeof onboardingPageData>>;
