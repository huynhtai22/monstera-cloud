/**
 * Shared request validation and error mapping for operator-only
 * extended-backfill pilot routes. Unknown keys are rejected so no request
 * parameter can smuggle enablement, stage, or configuration.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { PilotAdmissionError } from "@/lib/extended-backfill-pilot";
import { PilotNotFoundError, PilotStateError } from "@/lib/extended-backfill-pilot-lifecycle";
import { PilotConfigError } from "@/lib/extended-backfill-pilot";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PilotRangeSchema = z
  .object({
    workspaceId: z.string().min(1, "workspaceId is required"),
    provider: z.string().min(1, "provider is required"),
    connectionId: z.string().min(1).optional(),
    accountId: z.string().optional(),
    since: z.string().regex(DATE_RE, "since must be YYYY-MM-DD"),
    until: z.string().regex(DATE_RE, "until must be YYYY-MM-DD"),
  })
  .strict();

export const PilotJobsSchema = PilotRangeSchema.extend({
  connectionId: z.string().min(1, "connectionId is required"),
  clientKey: z.string().max(64).optional(),
  observedRowsPerDay: z.number().nonnegative().optional(),
  bytesPerRow: z.number().positive().optional(),
}).strict();

export const PilotWorkspaceSchema = z
  .object({ workspaceId: z.string().min(1, "workspaceId is required") })
  .strict();

export const PilotExecuteSchema = PilotWorkspaceSchema.extend({
  observedRowsPerDay: z.number().nonnegative().optional(),
  bytesPerRow: z.number().positive().optional(),
}).strict();

export const PilotResumeSchema = PilotWorkspaceSchema.extend({
  observedRowsPerDay: z.number().nonnegative().optional(),
  bytesPerRow: z.number().positive().optional(),
}).strict();

export function invalidBody() {
  return NextResponse.json({ error: "Validation failed", code: "INVALID_REQUEST" }, { status: 400 });
}

const REASON_STATUS: Record<string, number> = {
  WORKSPACE_NOT_FOUND: 404,
  CONNECTION_NOT_FOUND: 404,
  PROVIDER_CONNECTION_MISMATCH: 400,
  OVERLAPPING_JOB: 409,
  INVALID_DATE_RANGE: 400,
  PROVIDER_INELIGIBLE: 400,
  RANGE_EXCEEDS_PILOT_MAXIMUM: 400,
};

export function pilotRejectionResponse(error: unknown) {
  if (error instanceof PilotAdmissionError) {
    const status = REASON_STATUS[error.reasonCode] ?? 422;
    return NextResponse.json(
      { error: `Extended pilot request refused: ${error.reasonCode}`, code: error.reasonCode },
      { status },
    );
  }
  if (error instanceof PilotNotFoundError) {
    return NextResponse.json({ error: error.message, code: "PILOT_JOB_NOT_FOUND" }, { status: 404 });
  }
  if (error instanceof PilotStateError) {
    return NextResponse.json({ error: error.message, code: "PILOT_STATE_CONFLICT" }, { status: 409 });
  }
  if (error instanceof PilotConfigError) {
    return NextResponse.json({ error: "Extended pilot is misconfigured.", code: "PILOT_MISCONFIGURED" }, { status: 500 });
  }
  return null;
}
