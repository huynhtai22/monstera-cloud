/**
 * Role-Based Access Control (RBAC) for Workspace Multi-Tenancy
 *
 * Enforces:
 * 1. Master Identity (login email) is decoupled from Data Source Identity (OAuth email)
 * 2. Workspace membership is validated on every mutating request
 * 3. Role hierarchy: owner > admin > member > viewer
 * 4. Critical operations (delete workspace, delete pipeline, billing) are owner-only
 */

import prisma from "@/lib/prisma";
import type { WorkspaceRole as PrismaWorkspaceRole } from "@prisma/client";
import { logger } from "@/lib/logger";
import { emitMonitor } from "@/lib/observability/monitors";

export type WorkspaceRole = PrismaWorkspaceRole;

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
    owner: 4,
    admin: 3,
    member: 2,
    viewer: 1,
};

interface WorkspaceMembership {
    userId: string;
    workspaceId: string;
    role: WorkspaceRole;
}

/**
 * Strict role enum — ensures no invalid roles are persisted.
 */
export function sanitizeRole(role: string): WorkspaceRole {
    const valid: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];
    if (valid.includes(role as WorkspaceRole)) return role as WorkspaceRole;
    logger.warn(`[RBAC] Invalid role "${role}" — defaulting to viewer`);
    return "viewer";
}

/**
 * Resolve workspace membership for a user.
 * Returns null if the user is not a member of the workspace.
 */
export async function getWorkspaceMembership(
    userId: string,
    workspaceId: string
): Promise<WorkspaceMembership | null> {
    if (!userId || !workspaceId) return null;

    const member = await prisma.workspaceMember.findFirst({
        where: {
            userId,
            workspaceId,
        },
        select: {
            userId: true,
            workspaceId: true,
            role: true,
        },
    });

    if (!member) return null;

    return {
        userId: member.userId,
        workspaceId: member.workspaceId,
        role: sanitizeRole(member.role),
    };
}

/**
 * Check if a user has at least the required role in a workspace.
 */
export function hasRole(member: WorkspaceMembership | null, required: WorkspaceRole): boolean {
    if (!member) return false;
    return ROLE_HIERARCHY[member.role] >= ROLE_HIERARCHY[required];
}

/**
 * Enforce role requirement. Throws a typed error that should be caught
 * and returned as a 403 response.
 */
export function requireRole(
    member: WorkspaceMembership | null,
    required: WorkspaceRole,
    operation: string
): void {
    if (!member) {
        throw new RbacError(`Not a member of this workspace`, "FORBIDDEN", 403);
    }

    if (!hasRole(member, required)) {
        throw new RbacError(
            `Operation "${operation}" requires ${required} role — you are ${member.role}`,
            "INSUFFICIENT_ROLE",
            403,
            { currentRole: member.role, requiredRole: required }
        );
    }
}

/**
 * Higher-level guard for critical (destructive) operations.
 * Owner-only by default.
 */
export function requireOwner(member: WorkspaceMembership | null, operation: string): void {
    requireRole(member, "owner", operation);
}

/**
 * Typed RBAC error with structured metadata.
 */
export class RbacError extends Error {
    code: string;
    statusCode: number;
    metadata?: Record<string, unknown>;

    constructor(message: string, code: string, statusCode: number, metadata?: Record<string, unknown>) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.metadata = metadata;
    }
}

/**
 * Convenience wrapper for Next.js API routes.
 * Usage in a route handler:
 *
 *   const member = await getWorkspaceMembership(session.user.id, workspaceId);
 *   requireRole(member, "admin", "delete_pipeline");
 *
 */
export async function authorizeWorkspaceAction(
    userId: string,
    workspaceId: string,
    requiredRole: WorkspaceRole,
    operation: string
): Promise<WorkspaceMembership> {
    const member = await getWorkspaceMembership(userId, workspaceId);
    requireRole(member, requiredRole, operation);
    return member!;
}

/**
 * Middleware-style helper that also verifies the workspace exists
 * and the user has a valid membership.
 */
export async function requireWorkspaceAccess(
    userIdOrInput: string | {
        userId: string;
        workspaceId: string;
        minimumRole?: WorkspaceRole;
        operation?: string;
    },
    legacyWorkspaceId?: string,
    legacyRequiredRole: WorkspaceRole = "member"
): Promise<{ workspace: { id: string; ownerId: string }; membership: WorkspaceMembership }> {
    const input = typeof userIdOrInput === "string"
        ? {
            userId: userIdOrInput,
            workspaceId: legacyWorkspaceId ?? "",
            minimumRole: legacyRequiredRole,
            operation: "workspace_access",
        }
        : {
            ...userIdOrInput,
            minimumRole: userIdOrInput.minimumRole ?? "member",
            operation: userIdOrInput.operation ?? "workspace_access",
        };

    const [workspace, membership] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: input.workspaceId },
            select: { id: true, ownerId: true },
        }),
        getWorkspaceMembership(input.userId, input.workspaceId),
    ]);

    if (!workspace) {
        throw new RbacError("Workspace not found", "NOT_FOUND", 404);
    }

    if (!membership || !hasRole(membership, input.minimumRole)) {
        logger.warn("[TENANT_AUTHORIZATION_DENIED]", {
            actorUserId: input.userId,
            workspaceId: input.workspaceId,
            operation: input.operation,
            currentRole: membership?.role ?? null,
            requiredRole: input.minimumRole,
        });
        emitMonitor("tenant_authz_denied", {
            workspaceId: input.workspaceId,
            operation: input.operation,
            requiredRole: input.minimumRole,
        });
    }

    requireRole(membership, input.minimumRole, input.operation);

    return { workspace, membership: membership! };
}

export function toRbacResponse(error: unknown): Response | null {
    if (!(error instanceof RbacError)) return null;
    return Response.json(
        { error: error.message, code: error.code },
        { status: error.statusCode },
    );
}
