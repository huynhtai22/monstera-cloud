/** Customer-visible saved setup; credentials and authorization records stay server-side. */
export type DataHealthSetupDraft = {
  id: string;
  version: number;
  timezone: string;
  goalLabel?: string | null;
  onboardingRunId?: string | null;
  updatedAt: string;
  scopes: Array<{ connectionId: string; provider: string; providerAccountId: string; accountName: string | null }>;
};
