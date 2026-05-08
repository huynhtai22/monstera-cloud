/**
 * Application-layer tenant isolation helpers.
 *
 * Monstera uses `workspaceId` as the tenant key on workspace-owned rows (orders, metrics,
 * connections, OAuth-backed credentials on `Connection`, etc.). PostgreSQL Row-Level Security
 * is not enabled here; callers must pass `workspaceId` into queries. These helpers merge scope
 * consistently and guard obvious cross-tenant mistakes during development.
 */

import type { Prisma } from "@prisma/client";

export type WorkspaceWhere = { workspaceId: string };

/**
 * Merge Prisma `where` with mandatory `workspaceId`. If `where` already sets `workspaceId` and it
 * differs, throws — catches accidental mixing of user-supplied filters with the wrong tenant.
 */
export function mergeWorkspaceWhere<W extends Record<string, unknown>>(
  workspaceId: string,
  where?: W | null,
): W & WorkspaceWhere {
  const w = (where ?? {}) as W & Partial<WorkspaceWhere>;
  if (w.workspaceId != null && w.workspaceId !== workspaceId) {
    throw new Error("Workspace scope mismatch: where.workspaceId conflicts with enforced tenant");
  }
  return { ...w, workspaceId };
}

/** Typed helper for `RetailOrder` queries. */
export function scopeRetailOrderWhere(
  workspaceId: string,
  where?: Prisma.RetailOrderWhereInput,
): Prisma.RetailOrderWhereInput {
  return mergeWorkspaceWhere(workspaceId, where as Record<string, unknown> | null) as Prisma.RetailOrderWhereInput;
}

/** Typed helper for `CampaignMetric` warehouse queries. */
export function scopeCampaignMetricWhere(
  workspaceId: string,
  where?: Prisma.CampaignMetricWhereInput,
): Prisma.CampaignMetricWhereInput {
  return mergeWorkspaceWhere(workspaceId, where as Record<string, unknown> | null) as Prisma.CampaignMetricWhereInput;
}

/** Typed helper for `Connection` (OAuth tokens live in encrypted `credentials`). */
export function scopeConnectionWhere(
  workspaceId: string,
  where?: Prisma.ConnectionWhereInput,
): Prisma.ConnectionWhereInput {
  return mergeWorkspaceWhere(workspaceId, where as Record<string, unknown> | null) as Prisma.ConnectionWhereInput;
}
