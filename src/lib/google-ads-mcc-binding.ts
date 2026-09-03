/**
 * Connection identities derived from Google Ads account discovery.
 *
 * Each persisted source is one true MCC root or one unrelated standalone
 * customer. Child customers stay attached to their manager root and are
 * resolved at sync time with the correct login-customer-id.
 */

export type GoogleAdsDiscoveredRoot = {
  rootCustomerId: string;
  isManager: boolean;
  customerIds: string[];
};

export type GoogleAdsMccBinding = {
  remoteAccountId: string;
  name: string;
  credentials: Record<string, unknown>;
  discoveredCustomerCount: number;
};

function cleanCustomerId(value: unknown): string | null {
  const clean = String(value ?? "").replace(/\D/g, "");
  return clean.length > 0 ? clean : null;
}

function formatCustomerId(id: string): string {
  return id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

/**
 * Produces one stable, idempotent connection input per root. `customerIds`
 * intentionally contains only the root: the sync worker expands manager
 * children and supplies the parent MCC as login-customer-id.
 */
export function buildGoogleAdsMccBindings(opts: {
  roots: unknown;
  credentials: Record<string, unknown>;
  extraFields?: Record<string, unknown>;
}): GoogleAdsMccBinding[] {
  const seen = new Set<string>();
  const roots = Array.isArray(opts.roots) ? opts.roots : [];

  return roots.flatMap((rawRoot) => {
    if (!rawRoot || typeof rawRoot !== "object") return [];
    const root = rawRoot as Partial<GoogleAdsDiscoveredRoot>;
    const rootCustomerId = cleanCustomerId(root.rootCustomerId);
    if (!rootCustomerId || seen.has(rootCustomerId)) return [];
    seen.add(rootCustomerId);

    const isManager = root.isManager === true;
    const discoveredCustomerIds = Array.isArray(root.customerIds)
      ? [...new Set(root.customerIds.map(cleanCustomerId).filter((id): id is string => Boolean(id)))]
      : [];
    const displayId = formatCustomerId(rootCustomerId);
    const accountEmail = String(opts.credentials.accountEmail || opts.extraFields?.accountEmail || "").trim() || undefined;
    const accountName = String(opts.credentials.accountName || opts.extraFields?.accountName || "").trim() || undefined;
    const connectionExtras: Record<string, unknown> = {
      ...(opts.extraFields ?? {}),
      // Only this root is a sync target. The full discovered child list is
      // retained for truthful display and audit, not as parallel roots.
      customerIds: [rootCustomerId],
      discoveredCustomerIds,
      discoveredCustomerCount: discoveredCustomerIds.length || 1,
      googleAdsRootType: isManager ? "manager" : "customer",
      ...(accountEmail ? { accountEmail } : {}),
      ...(accountName ? { accountName } : {}),
    };

    if (isManager) {
      connectionExtras.mccId = rootCustomerId;
      connectionExtras.managerCustomerId = rootCustomerId;
    } else {
      delete connectionExtras.mccId;
      delete connectionExtras.managerCustomerId;
    }

    return [{
      remoteAccountId: rootCustomerId,
      name: isManager ? `Google Ads — MCC ${displayId}` : `Google Ads — Customer ${displayId}`,
      credentials: {
        ...opts.credentials,
        ...connectionExtras,
      },
      discoveredCustomerCount: discoveredCustomerIds.length || 1,
    }];
  });
}
