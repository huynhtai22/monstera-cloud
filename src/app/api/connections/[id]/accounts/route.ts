/**
 * Fetch available ad accounts for a connection
 * P1: Supports Meta Ads, Google Ads, TikTok Business
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
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

        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId: connection.workspaceId,
            minimumRole: "viewer",
            operation: "list_connection_accounts",
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
        const credentials = JSON.parse(decrypt(connection.credentials));
        const extraFields = credentials.extraFields || {};
        
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
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const { selectedIds } = body;

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
        const credentials = JSON.parse(decrypt(connection.credentials));
        credentials.extraFields = credentials.extraFields || {};
        
        if (connection.provider === "meta_ads") {
            credentials.extraFields.selectedAdAccountIds = selectedIds;
        } else if (connection.provider === "google_ads") {
            credentials.extraFields.selectedCustomerIds = selectedIds;
        } else if (connection.provider === "tiktok_business") {
            credentials.extraFields.selectedAdvertiserIds = selectedIds;
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
            message: `Selected ${selectedIds.length} accounts`,
            selectedIds,
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
