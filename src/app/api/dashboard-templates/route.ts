/**
 * API: Dashboard Templates
 * List available templates and create dashboard instances
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  getAvailableTemplates,
  getFeaturedTemplates,
  getTemplateBySlug,
  instantiateTemplate,
} from "@/lib/dashboard-templates";
import { logger } from "@/lib/logger";

// GET /api/dashboard-templates - List available templates
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const featured = searchParams.get("featured") === "true";
    const workspaceId = searchParams.get("workspaceId");

    if (featured) {
      // Return featured templates (for marketing/landing page)
      return NextResponse.json({
        templates: getFeaturedTemplates(),
      });
    }

    if (workspaceId) {
      // Check workspace membership
      const membership = await prisma.workspaceMember.findFirst({
        where: {
          workspaceId,
          userId: session.user.id,
        },
      });

      if (!membership) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      // Get connected sources for this workspace
      const connections = await prisma.connection.findMany({
        where: {
          workspaceId,
          type: "source",
          status: "connected",
        },
        select: {
          provider: true,
        },
      });

      const connectedSources = connections.map((c) => c.provider);

      return NextResponse.json({
        templates: getAvailableTemplates(connectedSources),
        connectedSources,
      });
    }

    // No workspace specified - return all templates
    return NextResponse.json({
      templates: getFeaturedTemplates(),
    });
  } catch (error) {
    logger.error("[GET /api/dashboard-templates]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/dashboard-templates - Create dashboard from template
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { workspaceId, templateSlug, name, overrides } = body;

    if (!workspaceId || !templateSlug) {
      return NextResponse.json(
        { error: "Missing workspaceId or templateSlug" },
        { status: 400 }
      );
    }

    // Check workspace membership
    const membership = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: session.user.id,
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get template
    const template = getTemplateBySlug(templateSlug);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Check if workspace has required sources
    const connections = await prisma.connection.findMany({
      where: {
        workspaceId,
        type: "source",
        status: "connected",
      },
      select: {
        provider: true,
      },
    });

    const connectedSources = connections.map((c) => c.provider);
    const hasAllSources = template.requiredSources.every((s) =>
      connectedSources.includes(s)
    );

    if (!hasAllSources && template.requiredSources.length > 0) {
      return NextResponse.json(
        {
          error: "Missing required sources",
          required: template.requiredSources,
          connected: connectedSources,
        },
        { status: 400 }
      );
    }

    // Create dashboard instance
    const dashboardData = instantiateTemplate(template, {
      name,
      ...overrides,
    });

    const dashboard = await prisma.userDashboard.create({
      data: {
        workspaceId,
        templateId: template.slug,
        ...dashboardData,
        isDefault: false,
        isShared: false,
      },
    });

    return NextResponse.json({
      dashboard,
      template: {
        slug: template.slug,
        name: template.name,
        description: template.description,
      },
    });
  } catch (error) {
    logger.error("[POST /api/dashboard-templates]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
