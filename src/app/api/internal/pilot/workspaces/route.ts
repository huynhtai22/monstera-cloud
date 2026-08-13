import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateInvitationToken, normalizeEmail, normalizeWorkspaceSlug } from "@/lib/invitation-security";
import type { WorkspaceRole } from "@prisma/client";

const ALLOWED_PROVIDERS = new Set(["meta_ads", "google_ads", "tiktok_business", "shopee"]);
const ALLOWED_PLANS = new Set(["pilot", "starter", "professional", "enterprise"]);

async function requireOperator(userId: string) {
  return prisma.user.findFirst({ where: { id: userId, platformRole: "OPERATOR" }, select: { id: true } });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await requireOperator(session.user.id))) {
    return NextResponse.json({ error: "Operator access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = normalizeEmail(String(body.email || ""));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const agencyName = typeof body.agencyName === "string" ? body.agencyName.trim() : "";
  const agencySlug = normalizeWorkspaceSlug(String(body.agencySlug || agencyName));
  const plan = ALLOWED_PLANS.has(String(body.plan)) ? String(body.plan) : "pilot";
  const enabledProviders: string[] = Array.isArray(body.enabledProviders)
    ? Array.from(new Set<string>(body.enabledProviders.filter((value: unknown): value is string => typeof value === "string" && ALLOWED_PROVIDERS.has(value))))
    : ["meta_ads", "google_ads", "tiktok_business", "shopee"];
  const role: WorkspaceRole = body.role === "viewer" || body.role === "member" || body.role === "admin" ? body.role : "member";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid owner or teammate email is required" }, { status: 400 });
  }

  let invitationData;
  if (workspaceId) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    invitationData = { workspaceId, role, enabledProviders: [] as string[] };
  } else {
    if (!agencyName || agencySlug.length < 3) {
      return NextResponse.json({ error: "Agency name and a valid slug are required" }, { status: 400 });
    }
    const [workspace, pending] = await Promise.all([
      prisma.workspace.findUnique({ where: { slug: agencySlug }, select: { id: true } }),
      prisma.workspaceInvitation.findFirst({
        where: { agencySlug, acceptedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      }),
    ]);
    if (workspace || pending) return NextResponse.json({ error: "Agency slug is already reserved" }, { status: 409 });
    invitationData = { agencyName, agencySlug, plan, role: "owner" as const, enabledProviders };
  }

  const generated = generateInvitationToken();
  const invitation = await prisma.workspaceInvitation.create({
    data: {
      ...invitationData,
      tokenHash: generated.tokenHash,
      email,
      invitedByUserId: session.user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    select: { id: true, email: true, expiresAt: true },
  });
  const origin = new URL(request.url).origin;
  return NextResponse.json(
    { ...invitation, invitationUrl: `${origin}/invite/${generated.token}` },
    { status: 201 },
  );
}
