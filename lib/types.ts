// Shared types for ApplyPilot-Cloud. Field names mirror the Supabase schema in
// supabase/migrations/0001_init.sql, which in turn derives from the
// ApplyPilot-Lite /api/jobs column contract (see docs/ARCHITECTURE.md).

export type JobStatus = 'unscored' | 'scored' | 'archived';

export interface Job {
  id: string;
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  full_description: string | null;
  application_url: string | null;
  /** true = LinkedIn Easy Apply (one-click); false = external application; null = unknown */
  easy_apply: boolean | null;
  /** 0–10; null = unscored. 0 = invalid content / not a real job description. */
  fit_score: number | null;
  score_note: string | null;
  score_keywords: string | null;
  score_reasoning: string | null;
  status: JobStatus;
  is_shortlisted: boolean;
  /** UUID of the Run that discovered this job. Null for jobs before migration 0003. */
  run_id: string | null;
  /** Timestamp when the user marked themselves as having applied. Null = not applied. */
  applied_at: string | null;
  discovered_at: string;
  scored_at: string | null;
  source: string | null;
}

/** Shape passed to the scorer. Mirrors the job fields scoring actually reads. */
export interface ScorableJob {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  full_description?: string | null;
  description?: string | null;
}

export interface ScoreResult {
  score: number;
  keywords: string;
  note: string;
  reasoning: string;
}

export interface Profile {
  id: number; // single-row table, always 1
  personal: Record<string, unknown>;
  experience: Record<string, unknown>;
  compensation: Record<string, unknown>;
  work_authorization: Record<string, unknown>;
  skills_boundary: Record<string, unknown>;
  resume_text: string;
  resume_pdf_path: string | null;
  updated_at: string;
}

export interface Settings {
  id: number; // single-row table, always 1
  schedule_time: string; // 'HH:MM' in the user's timezone
  timezone: string; // IANA tz, e.g. 'America/New_York'
  keywords: string[];
  locations: string[];
  hours_old: number; // default 24
  results_per_query: number;
  llm_provider: string; // 'gemini' | 'openai' | 'deepseek' | 'anthropic'
  llm_model: string;
  apify_actor_id: string; // LinkedIn actor variant (others use PORTAL_CONFIG defaults)
  job_portals: string[]; // e.g. ['linkedin', 'indeed', 'glassdoor']
  auto_scrape_enabled: boolean;
  updated_at: string;
}

export type RunStatus = 'running' | 'succeeded' | 'failed';

export interface Run {
  id: string;
  started_at: string;
  finished_at: string | null;
  jobs_found: number;
  jobs_scored: number;
  errors: number;
  apify_run_id: string | null;
  status: RunStatus;
}
