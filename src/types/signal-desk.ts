export type Health = {
  ok: boolean;
  x_provider: "mock" | "x_api" | string;
  x_configured: boolean;
  llm_configured: boolean;
  web_search_configured: boolean;
  web_status?: "ready" | "auth_error" | "unavailable" | "rate_limited" | "not_configured" | string;
  tavily_web_status?: "ready" | "auth_error" | "unavailable" | "rate_limited" | "not_configured" | "disabled" | string;
  cloud_llm_status?: "ready" | "auth_error" | "unavailable" | "not_configured" | string;
  local_llm_status?: "ready" | "unavailable" | "disabled" | "not_configured" | string;
  active_llm_provider?: string;
  active_llm_model?: string;
};

export type SearchSummary = {
  id: string;
  keyword: string;
  query: string;
  source: string;
  status: string;
  error_message: string | null;
  research_metadata: ResearchMetadata;
  post_count: number;
  created_at: string | null;
};

export type ResearchItem = {
  id: string;
  source_type: string;
  source_name: string;
  title: string;
  content: string;
  url: string;
  author: string | null;
  published_at: string | null;
  quality_score: number;
  promotional_risk: number;
  topic_labels: string[];
};

export type ResearchMetadata = {
  mode?: string;
  x_selection?: {
    candidate_count: number;
    after_prefilter: number;
    selected_count: number;
    classifier_used: boolean;
    rejected_count: number;
  };
  web_telemetry?: {
    search_calls: number;
    results_returned: number;
    pages_fetched: number;
    rate_limit_events: number;
  };
  trend_diagnostics?: {
    x_discussion_strength: number;
    web_coverage_strength: number;
    source_diversity: number;
    information_quality: number;
    promotional_risk: number;
    trend_confidence: number;
  };
};

export type CollectedPost = {
  id: string;
  x_post_id: string;
  origin: string;
  text: string;
  author_id: string | null;
  author_username: string | null;
  author_name: string | null;
  posted_at: string | null;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  bookmark_count: number;
  impression_count: number;
  lang: string | null;
  is_selected: boolean;
  selection_score: number;
  selection_reason: string;
  quality_metadata: Record<string, unknown>;
  collected_at: string | null;
  url: string | null;
};

export type Score = {
  id: string;
  reply_potential: number;
  share_potential: number;
  dwell_potential: number;
  follow_potential: number;
  originality: number;
  spam_risk: number;
  overall_score: number;
  topic_relevance: number;
  angle_saturation: string;
  evidence_strength: number;
  notes: string;
  label?: string;
  prompt_version: string;
  provider: string;
  model: string;
  created_at: string | null;
};

export type Draft = {
  id: string;
  text: string;
  status: string;
  content_pillar: string;
  hook_type: string;
  content_format: string;
  tone: string;
  target_audience: string;
  prompt_version: string;
  provider: string;
  model: string;
  created_at: string | null;
  score: Score | null;
};

export type Idea = {
  id: string;
  position: number;
  title: string;
  hook: string;
  angle: string;
  content_pillar: string;
  hook_type: string;
  content_format: string;
  tone: string;
  target_audience: string;
  content_angle: string;
  research_relevance: string;
  angle_saturation: string;
  why_this_angle: string;
  prompt_version: string;
  provider: string;
  model: string;
  created_at: string | null;
  drafts: Draft[];
};

export type EvidenceItem = {
  label: string;
  post_count: number;
  saturation: string;
  post_ids: string[];
  opportunity?: string;
};

export type AnalysisRun = {
  id: string;
  version: number;
  active: boolean;
  summary: string;
  common_topics: string[];
  hooks: string[];
  formats: string[];
  content_angles: string[];
  insights: Record<string, EvidenceItem[]>;
  prompt_version: string;
  provider: string;
  model: string;
  created_at: string | null;
  ideas: Idea[];
};

export type AnalysisVersion = {
  version: number;
  active: boolean;
  created_at: string | null;
};

export type SearchDetail = {
  id: string;
  keyword: string;
  query: string;
  source: string;
  status: string;
  error_message: string | null;
  research_metadata: ResearchMetadata;
  context_metadata?: Record<string, unknown>;
  created_at: string | null;
  posts: CollectedPost[];
  research_items: ResearchItem[];
  analysis: AnalysisRun | null;
  analysis_versions: AnalysisVersion[];
};

export type MorningBriefOpportunity = {
  id: string;
  rank: number;
  title: string;
  what_happened: string;
  why_it_matters: string;
  dominant_narrative: string;
  underused_angle: string;
  why_angle_valuable: string;
  x_signal: number;
  web_signal: number | null;
  source_diversity: number;
  saturation: "low" | "medium" | "high" | string;
  promotional_risk: number;
  trend_confidence: number;
  content_opportunity_score: number;
  curator_value_score?: number;
  surprising_part?: string;
  smart_reader_might_not_know?: string;
  deeper_mechanism?: string;
  best_specific_fact?: string;
  explainability?: string;
  curator_value_reason?: string;
  classification?: string;
  suggested_query: string;
  created_at: string | null;
};

export type MorningBriefTelemetry = {
  start_time?: number;
  timings_ms?: {
    total?: number;
    x_acquisition?: number;
    web_acquisition?: number;
    clustering?: number;
    synthesis?: number;
  };
  counts?: {
    raw_x_posts?: number;
    prefiltered_x_posts?: number;
    rejected_x_posts?: number;
    web_items?: number;
    extracted_topics?: number;
    selected_candidate_topics?: number;
    final_opportunities?: number;
    x_by_query?: Record<string, number>;
  };
  web_status?: "active" | "unavailable";
  llm_telemetry?: Array<{
    stage: string;
    duration_ms: number;
    prompt_version: string;
  }>;
};

export type MorningBrief = {
  id: string;
  status: "created" | "discovering" | "collecting_x" | "searching_web" | "clustering" | "synthesizing" | "completed" | "failed" | string;
  error_message: string | null;
  discovery_metadata: {
    queries?: string[];
    max_queries?: number;
    x_per_query?: number;
    total_x_cap?: number;
    web_configured?: boolean;
  };
  telemetry: MorningBriefTelemetry;
  opportunities: MorningBriefOpportunity[];
  created_at: string | null;
  completed_at: string | null;
};
