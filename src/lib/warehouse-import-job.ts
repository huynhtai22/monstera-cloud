import { getRedis } from "./redis";
import { logger } from "@/lib/logger";

export interface BatchImportJobResult {
  connectionId: string;
  provider: string;
  adAccountId?: string;
  ok: boolean;
  upserted?: number;
  rowsIngested?: number;
  error?: string;
}

export interface BatchImportJobState {
  id: string;
  workspaceId: string;
  status: "queued" | "running" | "completed" | "failed";
  since: string;
  until: string;
  totalItems: number;
  completedItems: number;
  approximateRows: number;
  results: BatchImportJobResult[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const JOB_KEY_PREFIX = "monstera:import_job:";
const JOB_TTL_SECONDS = 3600; // 1 hour

export async function createImportJob(params: {
  id: string;
  workspaceId: string;
  since: string;
  until: string;
  totalItems: number;
}): Promise<BatchImportJobState> {
  const redis = getRedis();
  const now = Date.now();
  const jobState: BatchImportJobState = {
    id: params.id,
    workspaceId: params.workspaceId,
    status: "queued",
    since: params.since,
    until: params.until,
    totalItems: params.totalItems,
    completedItems: 0,
    approximateRows: 0,
    results: [],
    createdAt: now,
    updatedAt: now,
  };

  const key = `${JOB_KEY_PREFIX}${params.id}`;
  await redis.set(key, JSON.stringify(jobState), { ex: JOB_TTL_SECONDS });
  return jobState;
}

export async function updateImportJob(
  jobId: string,
  patch: Partial<BatchImportJobState>
): Promise<BatchImportJobState | null> {
  const redis = getRedis();
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  const existingRaw = await redis.get(key);
  if (!existingRaw) return null;

  try {
    const existing: BatchImportJobState =
      typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw;

    const updated: BatchImportJobState = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };

    await redis.set(key, JSON.stringify(updated), { ex: JOB_TTL_SECONDS });
    return updated;
  } catch (err) {
    logger.error(`[updateImportJob] Error parsing state for ${jobId}`, err);
    return null;
  }
}

export async function getImportJob(jobId: string): Promise<BatchImportJobState | null> {
  const redis = getRedis();
  const key = `${JOB_KEY_PREFIX}${jobId}`;
  const raw = await redis.get(key);
  if (!raw) return null;

  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    logger.error(`[getImportJob] Error parsing state for ${jobId}`, err);
    return null;
  }
}
