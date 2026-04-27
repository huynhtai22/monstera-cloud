import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const LOCAL_DATALAKE_DIR = path.join(process.cwd(), 'tmp', 'datalake');
const DATA_LAKE_BUCKET = process.env.DATA_LAKE_BUCKET;
const DATA_LAKE_PREFIX = (process.env.DATA_LAKE_PREFIX ?? 'datasets/').replace(/^\/+/, '');
const AWS_REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

const s3Client = DATA_LAKE_BUCKET
  ? new S3Client({ region: AWS_REGION })
  : null;

function datasetKey(datasetId: string): string {
  return `${DATA_LAKE_PREFIX}${datasetId}.csv`;
}

function fileToNodeReadable(file: File): Readable {
  return Readable.fromWeb(file.stream() as any);
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body && typeof (body as { transformToWebStream?: () => globalThis.ReadableStream }).transformToWebStream === 'function') {
    const webStream = (body as { transformToWebStream: () => globalThis.ReadableStream }).transformToWebStream();
    return Readable.fromWeb(webStream as any);
  }
  if (body && typeof (body as { getReader?: () => unknown }).getReader === 'function') {
    return Readable.fromWeb(body as any);
  }
  throw new Error('Unsupported storage stream response body');
}

export function usesObjectStorage(): boolean {
  return Boolean(DATA_LAKE_BUCKET && s3Client);
}

export async function writeDatasetCsv(datasetId: string, file: File): Promise<{ sizeBytes: number; backend: 's3' | 'local' }> {
  const sizeBytes = Number(file.size ?? 0);

  if (usesObjectStorage() && DATA_LAKE_BUCKET && s3Client) {
    await s3Client.send(new PutObjectCommand({
      Bucket: DATA_LAKE_BUCKET,
      Key: datasetKey(datasetId),
      Body: fileToNodeReadable(file),
      ContentType: 'text/csv',
    }));

    return { sizeBytes, backend: 's3' };
  }

  if (!fs.existsSync(LOCAL_DATALAKE_DIR)) {
    fs.mkdirSync(LOCAL_DATALAKE_DIR, { recursive: true });
  }

  const outputPath = path.join(LOCAL_DATALAKE_DIR, `${datasetId}.csv`);
  await pipeline(fileToNodeReadable(file), fs.createWriteStream(outputPath));

  const localSize = sizeBytes > 0 ? sizeBytes : fs.statSync(outputPath).size;
  return { sizeBytes: localSize, backend: 'local' };
}

export async function readDatasetCsv(datasetId: string): Promise<Readable | null> {
  if (usesObjectStorage() && DATA_LAKE_BUCKET && s3Client) {
    try {
      const result = await s3Client.send(new GetObjectCommand({
        Bucket: DATA_LAKE_BUCKET,
        Key: datasetKey(datasetId),
      }));

      if (!result.Body) return null;
      return toNodeReadable(result.Body);
    } catch (err: any) {
      const code = String(err?.name ?? err?.Code ?? '');
      if (code === 'NoSuchKey' || code === 'NotFound') {
        return null;
      }
      throw err;
    }
  }

  const localPath = path.join(LOCAL_DATALAKE_DIR, `${datasetId}.csv`);
  if (!fs.existsSync(localPath)) {
    return null;
  }

  return fs.createReadStream(localPath);
}
