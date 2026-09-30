import { z } from "zod";

export const WorkProfileSchema = z.object({
  category: z.enum(["BUSINESS_OWNER", "GROWTH_MARKETER", "AGENCY_CONSULTANT", "ECOMMERCE_SELLER", "OPERATIONS_ANALYST", "OTHER"]).nullable(),
  context: z.string().trim().max(500).optional(),
}).strict();

export const CreateRunSchema = z.object({
  kind: z.literal("onboarding"),
  workspaceId: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200).optional(),
}).strict();

export const ProviderSchema = z.enum(["meta_ads", "google_ads", "tiktok_business", "shopee"]);
export const VersionSchema = z.number().int().nonnegative();
export const MessageSchema = z.object({
  messageId: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(4000),
  expectedVersion: VersionSchema,
}).strict();

export class AgentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly currentVersion?: number,
  ) { super(message); }
}

export type AgentScope = { userId: string; workspaceId: string };

import { DateSchema as CalendarDateSchema } from "./execution-contracts";

export const ConfirmScopeInputSchema = z.object({
  selectedAccountIds: z.array(z.string().trim().min(1)).min(1).max(50),
  since: CalendarDateSchema.optional(),
  until: CalendarDateSchema.optional(),
  expectedVersion: VersionSchema,
}).strict();
