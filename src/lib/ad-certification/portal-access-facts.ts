import { z } from "zod";
import type { ProviderAccessFacts } from "./types";

/** Facts a workspace owner must inspect in Google's developer and OAuth portals. */
export const googleAdsPortalAccessInputSchema = z.object({
  appAccountMode: z.literal("live"),
  grantedScopesOrPermissions: z.array(z.string().trim().min(1).max(200)).min(1).max(20)
    .refine((scopes) => scopes.includes("https://www.googleapis.com/auth/adwords"), {
      message: "Google Ads OAuth scope is required",
    }),
  accessLevelStatus: z.enum(["basic", "standard"]),
  authorizationModel: z.literal("oauth2_user_consent"),
  tokenLifecycleModel: z.literal("refreshable_offline"),
}).strict();

export type GoogleAdsPortalAccessInput = z.infer<typeof googleAdsPortalAccessInputSchema>;

const persistedPortalAccessFactsSchema = googleAdsPortalAccessInputSchema.extend({
  verificationSource: z.literal("portal_owner_confirmed"),
  verifiedAt: z.string().datetime(),
  status: z.literal("VERIFIED"),
}).strict();

/** Only accept an owner-confirmed record written by the authenticated confirmation route. */
export function parsePersistedGoogleAdsPortalFacts(value: unknown): Omit<ProviderAccessFacts, "observedApiVersion"> | null {
  const parsed = persistedPortalAccessFactsSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}
