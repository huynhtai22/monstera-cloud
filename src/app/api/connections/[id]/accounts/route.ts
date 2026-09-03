/**
 * Fetch available ad accounts for a connection
 * P1: Supports Meta Ads, Google Ads, TikTok Business
 */

import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { safeDecrypt, encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { metaAdsClient } from "@/lib/meta-ads";
import { googleAdsOAuthClient, googleAdsReportClient } from "@/lib/google-ads";
import { tiktokBusinessClient } from "@/lib/tiktok-business";
import { getValidOAuthToken } from "@/lib/oauth-framework/token-refresh";
import {
    authorizedConnectionAccountIds,
    validateConnectionAccountSelection,
    type AccountSelectionProvider,
} from "@/lib/connection-account-selection";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getAuthSession();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        // Get connection with permission check
        const connection = await prisma.connection.findFirst({
            where: {
                id,
                workspace: {
                    members: {
                        some: {
                            userId: session.user.id,
                        },
                    },
                },
            },
        });

        if (!connection) {
            return NextResponse.json(
                { error: "Connection not found" },
                { status: 404 }
            );
        }

        const url = new URL(request.url);
        const shouldRefresh = url.searchParams.get("refresh") === "true";

        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId: connection.workspaceId,
            minimumRole: shouldRefresh ? "member" : "viewer",
            operation: shouldRefresh ? "refresh_connection_accounts" : "list_connection_accounts",
        });

        // Only certain providers support account listing
        const supportedProviders = ["meta_ads", "google_ads", "tiktok_business"];
        if (!supportedProviders.includes(connection.provider)) {
            return NextResponse.json(
                { accounts: [], error: "Provider does not support account listing" },
                { status: 200 }
            );
        }

        // Decrypt credentials
        let credentials = JSON.parse(safeDecrypt(connection.credentials));
        let extraFields = credentials.extraFields || {};

        if (shouldRefresh) {
            try {
                const accessToken = await getValidOAuthToken({
                    id: connection.id,
                    credentials: connection.credentials,
                    provider: connection.provider,
                });

                // Re-read latest credentials from database so newly rotated tokens are never overwritten
                const latest = await prisma.connection.findUnique({
                    where: { id: connection.id },
                    select: { credentials: true },
                });
                if (latest?.credentials) {
                    credentials = JSON.parse(safeDecrypt(latest.credentials));
                    extraFields = credentials.extraFields || {};
                }

                if (connection.provider === "meta_ads" && accessToken) {
                    const discovered = await metaAdsClient.getAdAccounts(accessToken);
                    if (discovered.length > 0) {
                        const existingAdAccounts: any[] = extraFields.adAccounts || credentials.adAccounts || [];
                        const existingMap = new Map(existingAdAccounts.map((a: any) => [a.id, a]));
                        for (const acc of discovered) {
                            existingMap.set(acc.id, { id: acc.id, name: acc.name, currency: acc.currency });
                        }
                        const merged = Array.from(existingMap.values());
                        extraFields.adAccounts = merged;
                        extraFields.adAccountIds = merged.map((a: any) => a.id);
                        credentials.extraFields = extraFields;
                        await prisma.connection.update({
                            where: { id: connection.id },
                            data: { credentials: encrypt(JSON.stringify(credentials)) },
                        });
                    }
                } else if (connection.provider === "google_ads" && accessToken) {
                    let discovered: string[] = [];
                    if (connection.remoteAccountId) {
                        try {
                            const clients = await googleAdsReportClient.listCustomerClients(
                                accessToken,
                                connection.remoteAccountId
                            );
                            discovered = clients.filter((c) => !c.isManager).map((c) => c.customerId);
                        } catch {
                            discovered = await googleAdsOAuthClient.listAccessibleCustomers(accessToken);
                        }
                    } else {
                        discovered = await googleAdsOAuthClient.listAccessibleCustomers(accessToken);
                    }

                    if (discovered.length > 0) {
                        const existingIds: string[] = extraFields.customerIds || credentials.customerIds || [];
                        const mergedIds = Array.from(new Set([...existingIds, ...discovered]));
                        extraFields.customerIds = mergedIds;
                        credentials.extraFields = extraFields;
                        await prisma.connection.update({
                            where: { id: connection.id },
                            data: { credentials: encrypt(JSON.stringify(credentials)) },
                        });
                    }
                } else if (connection.provider === "tiktok_business" && accessToken) {
                    const discovery = await tiktokBusinessClient.listAuthorizedAdvertisers(accessToken);
                    if (discovery.advertiser_ids && discovery.advertiser_ids.length > 0) {
                        const existingIds: string[] = extraFields.advertiserIds || credentials.advertiserIds || [];
                        const mergedIds = Array.from(new Set([...existingIds, ...discovery.advertiser_ids]));
                        extraFields.advertiserIds = mergedIds;
                        credentials.extraFields = extraFields;
                        await prisma.connection.update({
                            where: { id: connection.id },
                            data: { credentials: encrypt(JSON.stringify(credentials)) },
                        });
                    }
                }
            } catch (refreshErr) {
                logger.warn(`[GET /api/connections/[id]/accounts] Live account discovery failed for connection ${connection.id}:`, refreshErr);
            }
        }
        
        // Extract accounts from stored credentials
        let accounts: Array<{ id: string; name: string; type: string; selected?: boolean }> = [];
        let unavailableCount = 0;
        
        if (connection.provider === "meta_ads") {
            // Meta stores adAccounts array in extraFields
            const adAccounts = extraFields.adAccounts || credentials.adAccounts || [];
            const adAccountIds = extraFields.adAccountIds || credentials.adAccountIds || [];
            const selectedIds = Array.isArray(extraFields.selectedAdAccountIds)
                ? extraFields.selectedAdAccountIds
                : Array.isArray(credentials.selectedAdAccountIds)
                    ? credentials.selectedAdAccountIds
                    : undefined;
            
            if (adAccounts.length > 0) {
                accounts = adAccounts.map((acc: any) => ({
                    id: acc.id,
                    name: acc.name || `Ad Account ${acc.id}`,
                    type: "ad_account",
                    selected: selectedIds ? selectedIds.includes(acc.id) : true,
                }));
            } else if (adAccountIds.length > 0) {
                accounts = adAccountIds.map((id: string) => ({
                    id,
                    name: `Ad Account ${id}`,
                    type: "ad_account",
                    selected: selectedIds ? selectedIds.includes(id) : true,
                }));
            }
        } else if (connection.provider === "google_ads") {
            // Google stores customerIds in extraFields
            const customerIds = extraFields.customerIds || credentials.customerIds || [];
            const selectedIds = Array.isArray(extraFields.selectedCustomerIds)
                ? extraFields.selectedCustomerIds
                : Array.isArray(credentials.selectedCustomerIds)
                    ? credentials.selectedCustomerIds
                    : undefined;
            unavailableCount = Number.isInteger(extraFields.unavailableCustomerCount)
                ? Number(extraFields.unavailableCustomerCount)
                : 0;
            
            accounts = customerIds.map((id: string) => ({
                id,
                name: `Customer ${id}`,
                type: "customer",
                selected: selectedIds ? selectedIds.includes(id) : true,
            }));
        } else if (connection.provider === "tiktok_business") {
            // TikTok stores advertiserIds in extraFields
            const advertiserIds = extraFields.advertiserIds || credentials.advertiserIds || [];
            const selectedIds = Array.isArray(extraFields.selectedAdvertiserIds)
                ? extraFields.selectedAdvertiserIds
                : Array.isArray(credentials.selectedAdvertiserIds)
                    ? credentials.selectedAdvertiserIds
                    : undefined;
            
            accounts = advertiserIds.map((id: string) => ({
                id,
                name: `Advertiser ${id}`,
                type: "advertiser",
                selected: selectedIds ? selectedIds.includes(id) : true,
            }));
        }
        
        return NextResponse.json({
            accounts,
            provider: connection.provider,
            total: accounts.length,
            selected: accounts.filter(a => a.selected).length,
            unavailableCount,
        });
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("[GET /api/connections/[id]/accounts]", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

/**
 * POST - Save selected accounts for a connection
 * Body: { selectedIds: string[] }
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getAuthSession();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const body: unknown = await request.json();
        const selectedIds = body && typeof body === "object" && !Array.isArray(body)
            ? (body as { selectedIds?: unknown }).selectedIds
            : undefined;

        if (!Array.isArray(selectedIds)) {
            return NextResponse.json(
                { error: "selectedIds must be an array" },
                { status: 400 }
            );
        }

        // Get connection with permission check
        const connection = await prisma.connection.findFirst({
            where: {
                id,
                workspace: {
                    members: {
                        some: {
                            userId: session.user.id,
                        },
                    },
                },
            },
        });

        if (!connection) {
            return NextResponse.json(
                { error: "Connection not found" },
                { status: 404 }
            );
        }

        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId: connection.workspaceId,
            minimumRole: "member",
            operation: "select_connection_accounts",
        });

        // Only for ad platforms
        const supportedProviders = ["meta_ads", "google_ads", "tiktok_business"];
        if (!supportedProviders.includes(connection.provider)) {
            return NextResponse.json(
                { error: "Provider does not support account selection" },
                { status: 400 }
            );
        }

        // Decrypt and update credentials
        const credentials = JSON.parse(safeDecrypt(connection.credentials));
        credentials.extraFields = credentials.extraFields || {};
        const selection = validateConnectionAccountSelection({
            provider: connection.provider as AccountSelectionProvider,
            selectedIds,
            authorizedIds: authorizedConnectionAccountIds(
                connection.provider as AccountSelectionProvider,
                credentials,
            ),
        });
        if (!selection.ok) {
            return NextResponse.json(
                { error: selection.error === "invalid_selection"
                    ? "selectedIds must contain non-empty account IDs"
                    : "Selected accounts are not available on this connection" },
                { status: 400 },
            );
        }
        
        if (connection.provider === "meta_ads") {
            credentials.extraFields.selectedAdAccountIds = selection.selectedIds;
        } else if (connection.provider === "google_ads") {
            credentials.extraFields.selectedCustomerIds = selection.selectedIds;
        } else if (connection.provider === "tiktok_business") {
            credentials.extraFields.selectedAdvertiserIds = selection.selectedIds;
        }

        // Save updated credentials
        const updated = await prisma.connection.updateMany({
            where: { id, workspaceId: connection.workspaceId },
            data: {
                credentials: encrypt(JSON.stringify(credentials)),
            },
        });
        if (updated.count !== 1) {
            return NextResponse.json({ error: "Connection not found" }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: `Selected ${selection.selectedIds.length} accounts`,
            selectedIds: selection.selectedIds,
        });
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("[POST /api/connections/[id]/accounts]", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
