import { createHash } from "node:crypto";
import prisma from "./prisma";
import { RbacError } from "./rbac";
import { parseReadinessRequest } from "./report-readiness-request";
import { queryWarehouse, type WarehouseQueryInput, type ScopedTransaction } from "./warehouse-query";
import type { ReportingWindow } from "./report-readiness";

export const REPORT_DATASET_CAP = 10_000;
/** Same snapshot function for retrieval and evaluation. Includes values, identities, ingestion clocks,
 * account context and explicit requirements: late corrections/deletions/config changes invalidate proof. */
export async function reportingDataset(tx: ScopedTransaction, workspaceId: string, clientId: string, window: ReportingWindow) {
  const client = await tx.client.findFirst({ where: { workspaceId, id: clientId }, select: { id: true, requiredProviders: true, requiredDestinations: true, requirementsConfiguredAt: true } });
  if (!client) throw new RbacError("Client not found", "NOT_FOUND", 404);
  const connection = { workspaceId, clientId, type: "source" };
  const [rows, contexts, sources] = await Promise.all([
    tx.campaignMetric.findMany({ where: { workspaceId, connection, date: { gte: new Date(`${window.start}T00:00:00Z`), lte: new Date(`${window.end}T23:59:59.999Z`) } }, orderBy: { id: "asc" }, take: REPORT_DATASET_CAP + 1 }),
    tx.accountReportingContext.findMany({ where: { workspaceId, connection }, orderBy: { id: "asc" }, take: REPORT_DATASET_CAP + 1 }),
    tx.connection.findMany({ where: connection, select: { id: true, provider: true }, orderBy: { id: "asc" }, take: REPORT_DATASET_CAP + 1 }),
  ]);
  const limited = [rows, contexts, sources].some(items => items.length > REPORT_DATASET_CAP);
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 1, workspaceId, client, window, rows, contexts, sources }, (_, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
  const evidenceAt = Math.max(client.requirementsConfiguredAt?.getTime() ?? 0, ...rows.map(r => Math.max(r.pulledAt.getTime(), r.createdAt.getTime())), ...contexts.map(c => c.updatedAt.getTime()));
  return { fingerprint, limited, evidenceAt, rowCount: rows.length, dataThroughDate: rows.map(r => r.date.toISOString().slice(0, 10)).sort().at(-1) ?? null };
}

/** Call ONLY after destination authentication. Browser session/configuration routes cannot mint receipts.
 * Retrieval and evidence are one Repeatable Read snapshot. Partial/filtered/empty exports never verify a client. */
export async function retrieveClientDelivery(input: WarehouseQueryInput & { clientId: string }, destination: "google_sheets" | "looker_studio" | null, actorId: string) {
  const parsed = parseReadinessRequest({ workspaceId: input.workspaceId, clientId: input.clientId,
    start: input.startDate?.toISOString().slice(0, 10), end: input.endDate?.toISOString().slice(0, 10) });
  if (!parsed || !input.startDate || !input.endDate) throw new RbacError("A valid client and 1–90 day reporting window are required", "INVALID_REQUEST", 400);
  return prisma.$transaction(async tx => {
    const snapshot = await reportingDataset(tx, input.workspaceId, input.clientId, parsed.window);
    const result = await queryWarehouse(input, tx);
    // A successful query is necessary but not sufficient: prove the whole dataset was retrieved.
    let receiptId: string | null = null;
    if (destination && !snapshot.limited && snapshot.rowCount > 0 && snapshot.dataThroughDate && !result.pagination.hasMore &&
        !input.cursor && !input.offset && !input.platforms?.length && !input.accountIds?.length && !input.connectionId && !input.campaignId && result.rows.length === snapshot.rowCount) {
      // Ensure the response data can actually be serialized before recording success.
      JSON.stringify(result);
      const receipt = await tx.destinationDeliveryReceipt.create({ data: {
        workspaceId: input.workspaceId, clientId: input.clientId, destination, actorId,
        windowStart: parsed.window.start, windowEnd: parsed.window.end,
        dataThroughDate: snapshot.dataThroughDate, datasetFingerprint: snapshot.fingerprint, rowCount: snapshot.rowCount,
      } });
      receiptId = receipt.id;
      await tx.auditEvent.create({ data: { workspaceId: input.workspaceId, action: "reporting_delivery.retrieved", resource: "client", resourceId: input.clientId,
        metadata: { receiptId, destination, window: parsed.window, rowCount: snapshot.rowCount, actorId } } });
    }
    return { ...result, receiptId };
  }, { isolationLevel: "RepeatableRead", timeout: 20_000 });
}
