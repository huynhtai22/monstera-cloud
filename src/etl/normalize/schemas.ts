import { z } from 'zod';

export const UtmSchema = z.object({
  utm_source: z.string().trim().optional(),
  utm_medium: z.string().trim().optional(),
  utm_campaign: z.string().trim().optional(),
  utm_content: z.string().trim().optional(),
  utm_term: z.string().trim().optional(),
});

export type UtmFields = z.infer<typeof UtmSchema>;

export const CanonicalCampaignMetricSchema = z.object({
  platform: z.enum(['meta_ads', 'google_ads', 'tiktok_business']),
  connectionId: z.string().min(1),
  accountId: z.string().min(1),
  accountName: z.string().optional(),
  campaignId: z.string().min(1),
  campaignName: z.string().min(1),
  date: z.string().min(8), // YYYY-MM-DD

  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  spend: z.number().nonnegative().default(0),
  conversions: z.number().nonnegative().optional(),
  revenue: z.number().nonnegative().optional(),
  roas: z.number().nonnegative().optional(),

  utm: UtmSchema.optional(),

  raw: z.record(z.string(), z.any()).optional(),
});

export type CanonicalCampaignMetric = z.infer<typeof CanonicalCampaignMetricSchema>;

export const CanonicalOrderSchema = z.object({
  platform: z.enum(['shopee', 'tiktok_shop']),
  connectionId: z.string().min(1),
  orderId: z.string().min(1),
  orderCreatedAt: z.string().min(10), // ISO
  currency: z.string().min(1),
  grossRevenue: z.number().nonnegative(),
  netRevenue: z.number().nonnegative().optional(),

  utm: UtmSchema.optional(),
  raw: z.record(z.string(), z.any()).optional(),
});

export type CanonicalOrder = z.infer<typeof CanonicalOrderSchema>;

