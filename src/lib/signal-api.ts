import type {
  Draft,
  Health,
  MorningBrief,
  SearchDetail,
  SearchSummary,
} from "@/types/signal-desk";

const BASE = "/api/signal";
const DEFAULT_TIMEOUT_MS = 300_000;

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const rec = detail as { code?: string; message?: string; error?: string };
    if (rec.message) return rec.message;
    if (rec.error) return rec.error;
  }
  return JSON.stringify(detail);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(
        "Request timed out waiting for Signal Desk backend. Please refresh to check progress."
      );
    }
    throw err;
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = formatDetail(body.detail ?? body.error) || JSON.stringify(body);
    } catch {
      detail = await response.text().catch(() => detail);
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

export const signalApi = {
  health: () => request<Health>("/health"),
  listSearches: () => request<{ items: SearchSummary[] }>("/searches"),
  createSearch: (
    keyword: string,
    mode = "keyword",
    context_metadata: Record<string, unknown> = {}
  ) =>
    request<SearchDetail>("/searches", {
      method: "POST",
      body: JSON.stringify({ keyword, mode, context_metadata }),
    }),
  getSearch: (id: string, version?: number) =>
    request<SearchDetail>(
      `/searches/${id}${version ? `?analysis_version=${version}` : ""}`
    ),
  analyze: (id: string, depth: "fast" | "deep" = "fast") =>
    request<SearchDetail>(`/searches/${id}/analyze?depth=${depth}`, {
      method: "POST",
    }),
  createDraft: (
    ideaId: string,
    depth: "concise" | "standard" | "deep" = "standard"
  ) =>
    request<Draft>(`/ideas/${ideaId}/draft?depth=${depth}`, {
      method: "POST",
    }),
  scoreDraft: (draftId: string) =>
    request<Draft>(`/drafts/${draftId}/score`, {
      method: "POST",
    }),

  // Morning Brief
  runMorningBrief: () =>
    request<MorningBrief>("/morning-briefs", { method: "POST" }),
  getLatestMorningBrief: () =>
    request<{ brief: MorningBrief | null }>("/morning-briefs/latest"),
  getMorningBrief: (id: string) =>
    request<MorningBrief>(`/morning-briefs/${id}`),
  listMorningBriefs: () =>
    request<{
      items: Array<{
        id: string;
        status: string;
        opportunity_count: number;
        created_at: string | null;
      }>;
    }>("/morning-briefs"),
};
