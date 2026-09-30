import { z } from "zod";

export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const WindowSchema = z.object({ since: DateSchema, until: DateSchema });
export const OfferedScopeSchema = z.object({
  connectionId: z.string(), accounts: z.array(z.object({ id: z.string(), name: z.string(), accountId: z.string().optional(), connectionId: z.string().optional() })),
  window: WindowSchema, discoveredAt: z.string(),
});
export const ConfirmedScopeSchema = WindowSchema.extend({ provider: z.enum(["tiktok_business", "meta_ads", "google_ads", "shopee"]).default("tiktok_business"), connectionId: z.string(), selectedAccountIds: z.array(z.string()).min(1), targets: z.array(z.object({ key: z.string(), connectionId: z.string(), accountId: z.string() })).min(1).optional() });

/** Legacy single-connection approvals remain readable. New approvals freeze exact pairs. */
export function scopeTargets(scope: z.infer<typeof ConfirmedScopeSchema>) {
  return scope.targets ?? scope.selectedAccountIds.map(accountId => ({ key: accountId, connectionId: scope.connectionId, accountId }));
}


export function initialImportWindow(now = new Date()) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { since: new Date(midnight - 7 * 86400000).toISOString().slice(0, 10), until: new Date(midnight - 86400000).toISOString().slice(0, 10) };
}
