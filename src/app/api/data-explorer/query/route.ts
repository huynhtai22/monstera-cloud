import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { parse } from 'csv-parse';
import { logger } from "@/lib/logger";
import { readDatasetCsv } from '@/lib/datalake-storage';

const DATASET_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function GET(request: Request) {
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
        const { searchParams } = new URL(request.url);
        const datasetId = searchParams.get('datasetId');
        // AG Grid infinite scroll parameters
        const startRow = parseInt(searchParams.get('startRow') || '0', 10);
        const endRow = parseInt(searchParams.get('endRow') || '100', 10);

        if (!datasetId) {
            return NextResponse.json({ error: "Missing datasetId" }, { status: 400 });
        }

        if (!DATASET_ID_PATTERN.test(datasetId)) {
            return NextResponse.json({ error: "Invalid datasetId" }, { status: 400 });
        }

        // Dataset IDs are prefixed with owner ID at upload time.
        if (!datasetId.startsWith(`${userId}_`)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const readStream = await readDatasetCsv(datasetId);
        if (!readStream) {
            return NextResponse.json({ error: "Dataset not found in Datalake" }, { status: 404 });
        }

        // 2. Stream and Parse ONLY the requested rows
        // Using csv-parse stream to avoid loading a 100MB file into memory
        return new Promise<NextResponse>((resolve) => {
            const results: any[] = [];
            let currentRow = 0;
            let headers: string[] = [];
            let isResolved = false;

            const parser = readStream.pipe(
                parse({
                    columns: true, // Output objects instead of arrays
                    skip_empty_lines: true,
                    trim: true
                })
            );

            parser.on('data', (data) => {
                if (currentRow === 0) {
                    // Extract headers from the first data object keys
                    headers = Object.keys(data);
                }

                if (currentRow >= startRow && currentRow < endRow) {
                    results.push(data);
                }

                // Optimization: Terminate parsing early if we've reached the end of the requested page
                if (currentRow >= endRow) {
                    parser.pause();
                    readStream.destroy();
                    if (!isResolved) {
                        isResolved = true;
                        resolve(NextResponse.json({
                            rows: results,
                            lastRow: -1, // -1 tells AG Grid we don't know the exact end yet
                            columns: headers
                        }));
                    }
                }

                currentRow++;
            });

            parser.on('end', () => {
                if (!isResolved) {
                    isResolved = true;
                    resolve(NextResponse.json({
                        rows: results,
                        lastRow: currentRow, // We hit the actual end of the file
                        columns: headers
                    }));
                }
            });

            parser.on('error', (err) => {
                logger.error("CSV Parse Error:", err);
                if (!isResolved) {
                    isResolved = true;
                    resolve(NextResponse.json({ error: "Failed to parse dataset" }, { status: 500 }));
                }
            });
        });

    } catch (error) {
        logger.error("Error querying data lake:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
