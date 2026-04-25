/**
 * Fetch available ad accounts for a connection
 * P1: Supports Meta Ads, Google Ads, TikTok Business
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { getProvider } from "@/lib/oauth-framework/registry";
import { logger } from "@/lib/logger";

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
        
        // Get provider adapter
        const adapter = getProvider(connection.provider);
        
        // Fetch accounts using the adapter
        // Note: This requires the adapter to have a listAccounts method
        // For now, return mock data structure
        // TODO: Implement listAccounts in provider adapters
        
        // Return a structure that the UI expects
        return NextResponse.json({
            accounts: [], // Placeholder - would be populated by adapter.listAccounts()
            provider: connection.provider,
            note: "Account listing not yet implemented for this provider",
        });
    } catch (error) {
        logger.error("[GET /api/connections/[id]/accounts]", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
