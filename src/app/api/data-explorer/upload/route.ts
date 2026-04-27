import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { v4 as uuidv4 } from 'uuid';
import { logger } from "@/lib/logger";
import { writeDatasetCsv, usesObjectStorage } from '@/lib/datalake-storage';

// Must set config to disable Next.js default body parser for streaming forms
// Next.js App Router no longer supports this config object exported this way in Route Handlers.
// In a real app we would use an edge runtime or handle the stream directly from the Request.

export async function POST(req: Request) {
    // 1. Authenticate Request
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        if (process.env.NODE_ENV === 'production' && !usesObjectStorage()) {
            logger.error('[DataExplorer] Upload blocked: DATA_LAKE_BUCKET is required in production');
            return NextResponse.json(
                { error: 'Data Explorer storage is not configured for production.' },
                { status: 503 }
            );
        }

        // 2. Process multipart form payload
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        if (!file.name.endsWith('.csv')) {
            return NextResponse.json({ error: "Only CSV files are currently supported for the Data Explorer preview." }, { status: 400 });
        }

        // 3. Prefix dataset ID with owner ID to enforce object-level access checks.
        const datasetId = `${userId}_${uuidv4()}`;

        // 4. Stream to configured storage backend (S3 if configured, local disk otherwise)
        const { sizeBytes } = await writeDatasetCsv(datasetId, file);

        // Calculate size for the UI
        const sizeInMb = (sizeBytes / (1024 * 1024)).toFixed(2);

        // 5. Return dataset ID for subsequent paginated queries
        return NextResponse.json({
            success: true,
            datasetId,
            filename: file.name,
            size: `${sizeInMb} MB`,
            storage: usesObjectStorage() ? 'object-storage' : 'local-disk',
            message: "File successfully ingested into data lake."
        }, { status: 201 });

    } catch (error) {
        logger.error("Error processing file upload:", error);
        return NextResponse.json({ error: "Failed to process upload" }, { status: 500 });
    }
}
