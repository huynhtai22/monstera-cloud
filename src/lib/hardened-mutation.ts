/**
 * Hardened mutation helpers — multi-tenancy ownership guards.
 *
 * Pattern: every UPDATE/DELETE that touches a resource must include
 * `workspaceId` in the where clause so cross-workspace mutations are
 * impossible even if a resourceId is guessed (IDOR prevention).
 *
 * Usage:
 *   const conn = await assertConnectionOwnership(connectionId, workspaceId);
 *   // conn is guaranteed to belong to workspaceId — safe to mutate.
 */

import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// ── Ownership assertion helpers ───────────────────────────────────────────────

export async function assertConnectionOwnership(
  connectionId: string,
  workspaceId: string,
) {
  const conn = await prisma.connection.findFirst({
    where: { id: connectionId, workspaceId },
    select: { id: true, workspaceId: true },
  });
  if (!conn) return null;
  return conn;
}

export async function assertPipelineOwnership(
  pipelineId: string,
  workspaceId: string,
) {
  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, workspaceId },
    select: { id: true, workspaceId: true },
  });
  if (!pipeline) return null;
  return pipeline;
}

export async function assertWorkspaceMembership(
  workspaceId: string,
  userId: string,
) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { workspaceId: true, role: true },
  });
  return member ?? null;
}

// ── Standard error responses ──────────────────────────────────────────────────

export const notFound = (resource = 'Resource') =>
  NextResponse.json({ error: `${resource} not found` }, { status: 404 });

export const forbidden = () =>
  NextResponse.json({ error: 'Forbidden' }, { status: 403 });

export const unauthorized = () =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

// ── Credential sanitization ───────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'credentials',
  'token',
  'secret',
  'password',
  'apiKey',
  'api_key',
]);

/**
 * Strip sensitive credential fields from any object before returning it
 * to the frontend. Safe to call on connection rows.
 */
export function sanitizeCredentials<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = '[REDACTED]';
    } else if (out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = sanitizeCredentials(out[key] as Record<string, unknown>);
    }
  }
  return out as T;
}
