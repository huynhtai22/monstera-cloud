import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

// Must set config to disable Next.js default body parser for streaming forms
// Next.js App Router no longer supports this config object exported this way in Route Handlers.
// In a real app we would use an edge runtime or handle the stream directly from the Request.

export async function POST(req: Request) {
    // 1. Authenticate Request
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // 2. Setup Datalake path (using a local tmp directory for this prototype)
        // In production, this would stream directly to S3 or GCS
        const projectRoot = process.cwd();
        const uploadDir = path.join(projectRoot, 'tmp', 'datalake');

        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // 3. Process the multipart form data manually (since App Router Request doesn't play nice with old Formidable directly)
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        if (!file.name.endsWith('.csv')) {
            return NextResponse.json({ error: "Only CSV files are currently supported for the Data Explorer preview." }, { status: 400 });
        }

        // 4. Generate a unique Dataset ID
        const datasetId = uuidv4();
        const safeFilename = `${datasetId}.csv`;
        const filepath = path.join(uploadDir, safeFilename);

        // 5. Stream the file to the "Datalake" (Disk)
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(filepath, buffer);

        // Calculate size for the UI
        const sizeInMb = (buffer.length / (1024 * 1024)).toFixed(2);

        // 6. Return the Dataset ID so the frontend can query it via AG Grid
        return NextResponse.json({
            success: true,
            datasetId,
            filename: file.name,
            size: `${sizeInMb} MB`,
            message: "File successfully ingested into Datalake."
        }, { status: 201 });

    } catch (error) {
        console.error("Error processing file upload:", error);
        return NextResponse.json({ error: "Failed to process upload" }, { status: 500 });
    }
}
