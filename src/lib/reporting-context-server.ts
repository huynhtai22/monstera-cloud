import prisma from "./prisma";
import { currencySchema, timezoneSchema } from "./reporting-context";
import { RbacError } from "./rbac";

/** Internal sync boundary only. Never exposed as a browser mutation. Missing/invalid facts remain null. */
export async function recordProviderReportingContext(input: {
  workspaceId: string; connectionId: string; accountId: string; provider: string;
  timezone: unknown; currency: unknown;
}) {
  const timezone = timezoneSchema.safeParse(input.timezone);
  const currency = currencySchema.safeParse(input.currency);
  return prisma.$transaction(async tx => {
    const connection = await tx.connection.findFirst({ where: { id: input.connectionId, workspaceId: input.workspaceId, provider: input.provider, type: "source" }, select: { id: true } });
    if (!connection) throw new RbacError("Source not found", "NOT_FOUND", 404);
    const key = { workspaceId: input.workspaceId, connectionId: input.connectionId, accountId: input.accountId };
    const before = await tx.accountReportingContext.findFirst({ where: key });
    const facts = { providerTimezone: timezone.success ? timezone.data : null, providerCurrency: currency.success ? currency.data : null };
    // No silent carry-forward after the provider stops supplying a previously known field.
    const changed = !before || before.providerTimezone !== facts.providerTimezone || before.providerCurrency !== facts.providerCurrency;
    if (!changed) return before;
    const after = await tx.accountReportingContext.upsert({
      where: { workspaceId_connectionId_accountId: key },
      create: { ...key, ...facts, providerObservedAt: new Date() },
      update: { ...facts, providerObservedAt: new Date() },
    });
    await tx.auditEvent.create({ data: { workspaceId: input.workspaceId, action: "reporting_context.provider_observed", resource: "account", resourceId: after.id,
      metadata: { accountId: input.accountId, connectionId: input.connectionId, before: before ? { timezone: before.providerTimezone, currency: before.providerCurrency } : null, after: facts } } });
    return after;
  });
}
