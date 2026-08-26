import type { SourceHealthState } from "@/lib/source-health";

/** Warehouse freshness has no `partial`; union with source health so partial still wins. */
export type EvidenceFreshness = "fresh" | "stale" | "partial" | "failed" | "never" | "refreshing";

const SOURCE_TO_FRESHNESS: Record<SourceHealthState, EvidenceFreshness> = {
  partial: "partial",
  error: "failed",
  disconnected: "never",
  unknown: "never",
  pending: "never",
  syncing: "refreshing",
  stale: "stale",
  fresh: "fresh",
};

const RANK: Record<EvidenceFreshness, number> = {
  partial: 0,
  failed: 1,
  never: 2,
  stale: 3,
  refreshing: 4,
  fresh: 5,
};

export function freshnessFromSourceHealth(state: SourceHealthState): EvidenceFreshness {
  return SOURCE_TO_FRESHNESS[state];
}

/** Worst-of reduce. `partial` always wins. Empty input is `never`. */
export function reduceFreshness(states: Array<SourceHealthState | EvidenceFreshness>): EvidenceFreshness {
  if (states.length === 0) return "never";
  let worst: EvidenceFreshness = "fresh";
  for (const state of states) {
    const mapped = isEvidenceFreshness(state) ? state : freshnessFromSourceHealth(state);
    if (RANK[mapped] < RANK[worst]) worst = mapped;
  }
  return worst;
}

function isEvidenceFreshness(value: string): value is EvidenceFreshness {
  return value in RANK;
}

export type EvidenceCitation = {
  connectionId?: string;
  accountId?: string;
  campaignId?: string;
  date?: string;
  platform?: string;
  currency?: string;
  querySpec?: Record<string, unknown>;
};

export type EvidencePack = {
  freshness: EvidenceFreshness;
  currencies: string[];
  lastDataThrough: string | null;
  completeness: {
    sourceCount: number;
    partialCount: number;
    missingDays: number;
  };
  attribution: {
    model: "platform_reported" | "time_decay";
    matchRate?: number;
  };
  citations: EvidenceCitation[];
};
