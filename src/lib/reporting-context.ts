import { z } from "zod";

export const REPORT_PROVIDERS = ["meta_ads", "google_ads", "tiktok_business", "shopee", "lazada"] as const;
export const REPORT_DESTINATIONS = ["google_sheets", "looker_studio"] as const;
export const timezoneSchema = z.string().trim().max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return Boolean(value); } catch { return false; }
}, "Use a valid IANA timezone").transform(value => new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone);
export const currencySchema = z.string().trim().toUpperCase().refine(value =>
  Intl.supportedValuesOf("currency").includes(value), "Use an ISO currency code");
export const contextOverrideSchema = z.object({
  connectionId: z.string().min(1).max(160), accountId: z.string().min(1).max(160),
  timezone: timezoneSchema.nullable(), currency: currencySchema.nullable(),
  reason: z.string().trim().min(10).max(500),
}).strict();
export const requirementsSchema = z.object({
  providers: z.array(z.enum(REPORT_PROVIDERS)).min(1).max(5),
  destinations: z.array(z.enum(REPORT_DESTINATIONS)).min(1).max(2),
}).strict();

export type ReportingContextEvidence = {
  accountId: string; providerTimezone: string | null; providerCurrency: string | null;
  providerObservedAt: string | null; overrideTimezone: string | null; overrideCurrency: string | null;
  overrideAt: string | null;
};
export function effectiveReportingContext(context: ReportingContextEvidence | undefined) {
  const timezone = context?.overrideAt && context.overrideTimezone ? context.overrideTimezone : context?.providerObservedAt ? context.providerTimezone : null;
  const currency = context?.overrideAt && context.overrideCurrency ? context.overrideCurrency : context?.providerObservedAt ? context.providerCurrency : null;
  return {
    timezone: timezoneSchema.safeParse(timezone).success ? timezone : null,
    currency: currencySchema.safeParse(currency).success ? currency : null,
    timezoneConflict: Boolean(context?.overrideAt && context.providerObservedAt && context.overrideTimezone && context.providerTimezone && context.overrideTimezone !== context.providerTimezone),
    currencyConflict: Boolean(context?.overrideAt && context.providerObservedAt && context.overrideCurrency && context.providerCurrency && context.overrideCurrency !== context.providerCurrency),
  };
}
