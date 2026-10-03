import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { ReportEmailDeliveryAttempt } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth-session";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { reopenWeeklyBlueprint } from "@/lib/report-blueprint";
import { sendApprovedBlueprintEmail } from "@/lib/mail";
import { renderApprovedReportEmail } from "@/lib/report-email";
import { reportEmailClaimDisposition } from "@/lib/report-email-claim-policy";
import { hashReportEmailRecipient } from "@/lib/report-email-recipient";

const STALE_CLAIM_MS = 10 * 60 * 1000;

function maskedEmail(email: string): string {
  const [local, domain] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const suffix = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}***@${domainName.slice(0, 1)}***${suffix}`;
}

function isUniqueConstraint(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

function publicAttempt(attempt: {
  id: string;
  status: string;
  recipientDisplay: string;
  providerMessageId: string | null;
  failureCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}) {
  return {
    id: attempt.id,
    status: attempt.status,
    recipient: attempt.recipientDisplay,
    providerMessageId: attempt.providerMessageId,
    failureCode: attempt.failureCode,
    attemptedAt: attempt.createdAt.toISOString(),
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
  };
}

/** POST /api/reports/email — email one exact, current, approved Blueprint snapshot. */
export async function POST(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
    const snapshotId = typeof body?.snapshotId === "string" ? body.snapshotId : "";
    const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
    const recipient = typeof body?.recipient === "string" ? body.recipient.trim() : "";
    if (!workspaceId || !snapshotId || !idempotencyKey || !recipient) {
      return NextResponse.json({ error: "workspaceId, snapshotId, recipient, and idempotencyKey are required" }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) {
      return NextResponse.json({ error: "A valid idempotency key is required" }, { status: 400 });
    }
    if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || /[\r\n]/.test(recipient)) {
      return NextResponse.json({ error: "Enter one valid email address" }, { status: 400 });
    }
    const recipientHash = hashReportEmailRecipient(recipient);

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "member",
      operation: "send_approved_report_email",
    });

    const snapshot = await prisma.reportSnapshot.findFirst({
      where: { id: snapshotId, workspaceId },
      select: {
        id: true,
        workspaceId: true,
        clientId: true,
        reportingWindowStart: true,
        reportingWindowEnd: true,
      },
    });
    if (!snapshot) return NextResponse.json({ error: "Report snapshot not found" }, { status: 404 });

    const existingRequest = await prisma.reportEmailDeliveryAttempt.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
    });
    if (existingRequest) {
      if (
        existingRequest.snapshotId !== snapshotId ||
        !existingRequest.recipientHash ||
        existingRequest.recipientHash !== recipientHash
      ) {
        return NextResponse.json({ error: "Idempotency key was already used for another send" }, { status: 409 });
      }
      let replayedAttempt = existingRequest;
      if (
        existingRequest.status === "PROVIDER_STARTED" &&
        Date.now() - existingRequest.providerStartedAt.getTime() > STALE_CLAIM_MS
      ) {
        await prisma.reportEmailDeliveryAttempt.updateMany({
          where: { id: existingRequest.id, status: "PROVIDER_STARTED" },
          data: {
            status: "AMBIGUOUS",
            failureCode: "process_interrupted",
            finishedAt: new Date(),
          },
        });
        replayedAttempt = await prisma.reportEmailDeliveryAttempt.findUniqueOrThrow({
          where: { id: existingRequest.id },
        });
      }
      return NextResponse.json({ attempt: publicAttempt(replayedAttempt), idempotent: true }, {
        status: replayedAttempt.status === "PROVIDER_STARTED" || replayedAttempt.status === "AMBIGUOUS" ? 202 : 200,
      });
    }

    // Reopen from live dependencies immediately before claiming the send. This
    // checks the exact snapshot, captured READY state, and current approval.
    const reopened = await reopenWeeklyBlueprint({
      workspaceId,
      clientId: snapshot.clientId,
      windowStart: snapshot.reportingWindowStart.toISOString().slice(0, 10),
      windowEnd: snapshot.reportingWindowEnd.toISOString().slice(0, 10),
    });
    if (
      !reopened.snapshot ||
      reopened.snapshot?.id !== snapshotId ||
      reopened.snapshot.freshness.freshness !== "CURRENT" ||
      reopened.lifecycle.approvalStatus !== "APPROVED" ||
      reopened.lifecycle.dataStatus !== "READY" ||
      reopened.approval?.snapshotId !== snapshotId ||
      !reopened.report
    ) {
      return NextResponse.json({
        error: "Only the exact current snapshot with READY data and a current approval can be emailed",
        code: "snapshot_not_sendable",
      }, { status: 409 });
    }

    const claimKey = createHash("sha256")
      .update(`approved-report-email:${workspaceId}:${snapshotId}`)
      .digest("hex");
    const unresolvedAmbiguous = await prisma.reportEmailDeliveryAttempt.findFirst({
      where: {
        workspaceId,
        clientId: snapshot.clientId,
        snapshotId,
        status: "AMBIGUOUS",
      },
      orderBy: { createdAt: "desc" },
    });
    if (unresolvedAmbiguous) {
      return NextResponse.json({
        attempt: publicAttempt(unresolvedAmbiguous),
        error: "The provider outcome is unknown; reconcile the existing send before retrying",
        code: "send_in_progress_or_ambiguous",
      }, { status: 409 });
    }
    const active = await prisma.reportEmailDeliveryAttempt.findUnique({ where: { activeClaimKey: claimKey } });
    if (active) {
      const disposition = reportEmailClaimDisposition({
        status: active.status,
        providerStartedAt: active.providerStartedAt,
        now: Date.now(),
        staleAfterMs: STALE_CLAIM_MS,
      });
      if (disposition === "mark_ambiguous") {
        await prisma.reportEmailDeliveryAttempt.updateMany({
          where: { id: active.id, status: "PROVIDER_STARTED", activeClaimKey: claimKey },
          data: {
            status: "AMBIGUOUS",
            failureCode: "process_interrupted",
            finishedAt: new Date(),
          },
        });
        const ambiguous = await prisma.reportEmailDeliveryAttempt.findUniqueOrThrow({
          where: { id: active.id },
        });
        return NextResponse.json({
          attempt: publicAttempt(ambiguous),
          idempotent: false,
          error: "The provider outcome is unknown; reconcile the existing send before retrying",
          code: "send_in_progress_or_ambiguous",
        }, { status: 202 });
      }
      if (disposition === "ambiguous") {
        return NextResponse.json({
          attempt: publicAttempt(active),
          idempotent: false,
          error: "The provider outcome is unknown; reconcile the existing send before retrying",
          code: "send_in_progress_or_ambiguous",
        }, { status: 409 });
      }
      if (disposition === "in_progress") {
        return NextResponse.json({
          attempt: publicAttempt(active),
          error: "A send for this snapshot is already in progress or its provider outcome is unknown",
          code: "send_in_progress_or_ambiguous",
        }, { status: 409 });
      }
    }

    let attempt: ReportEmailDeliveryAttempt;
    try {
      attempt = await prisma.reportEmailDeliveryAttempt.create({
        data: {
          workspaceId,
          clientId: snapshot.clientId,
          snapshotId,
          actorUserId: session.user.id,
          idempotencyKey,
          activeClaimKey: claimKey,
          recipientDisplay: maskedEmail(recipient),
          recipientHash,
          status: "PROVIDER_STARTED",
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        return NextResponse.json({
          error: "A send for this snapshot is already in progress or its provider outcome is unknown",
          code: "send_in_progress_or_ambiguous",
        }, { status: 409 });
      }
      throw error;
    }

    const rendered = renderApprovedReportEmail(reopened.report);
    const outcome = await sendApprovedBlueprintEmail({
      to: recipient,
      ...rendered,
      idempotencyKey: attempt.id,
    });
    const updated = await prisma.reportEmailDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: outcome.status,
        providerMessageId: outcome.status === "ACCEPTED" ? outcome.providerMessageId : null,
        failureCode: outcome.status === "ACCEPTED" ? null : outcome.failureCode,
        finishedAt: new Date(),
        activeClaimKey: outcome.status === "AMBIGUOUS" ? claimKey : null,
      },
    });
    return NextResponse.json({ attempt: publicAttempt(updated), idempotent: false }, {
      status: outcome.status === "ACCEPTED" ? 200 : outcome.status === "AMBIGUOUS" ? 202 : 502,
    });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    console.error("[report-email] operation failed:", error);
    return NextResponse.json({ error: "Could not email this report snapshot" }, { status: 500 });
  }
}
