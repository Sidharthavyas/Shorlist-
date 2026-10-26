export type Eligibility = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'REVIEW_REQUIRED';
export type RemoteType = 'WORLDWIDE_REMOTE' | 'INDIA_REMOTE' | 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN';
export type Availability = 'OPEN' | 'CLOSED' | 'EXPIRED' | 'UNKNOWN';
export type ApplicationStatus = 'NEW' | 'SAVED' | 'REVIEW' | 'APPLYING' | 'APPLIED' | 'APPLICATION_CONFIRMED' | 'ONLINE_ASSESSMENT' | 'RECRUITER_RESPONSE' | 'INTERVIEW' | 'TECHNICAL_INTERVIEW' | 'FINAL_ROUND' | 'OFFER' | 'REJECTED' | 'WITHDRAWN' | 'CLOSED';
export interface ExperienceAnalysis {
  classification: Eligibility;
  min_years: number | null;
  max_years: number | null;
  confidence: number;
  reason: string;
  evidence: Array<{ field: string; quote: string; mandatory: boolean | null }>;
  parser_version: string;
}
export interface NormalizedJob {
  external_id: string;
  public_slug: string | null;
  source: string;
  company: string;
  title: string;
  description: string;
  requirements: string[];
  preferred_qualifications: string[];
  location: string;
  remote_type: RemoteType;
  allowed_countries: string[] | null;
  timezone_compatible?: boolean;
  job_url: string;
  apply_url: string | null;
  posted_at: string | null;
  first_seen_at: string;
  experience_min: number | null;
  experience_max: number | null;
  skills: string[];
  salary: { min: number | null; max: number | null; currency: string; period: string } | null;
  employment_type: string | null;
  seniority: string | null;
  availability: Availability;
}
export interface SourcePage {
  jobs: unknown[];
  next_cursor: string | null;
  retry_after_seconds?: number;
}
export interface JobSource {
  readonly name: string;
  fetchJobs(input: { cursor: string | null; window_start: string; signal: AbortSignal }): Promise<SourcePage>;
  normalize(raw: unknown, discovered_at: string): NormalizedJob;
}
export interface TaskEnvelope {
  schema_version: 1;
  task_id: string;
  kind: 'ANALYZE_JOB' | 'SAVE_SNAPSHOT' | 'NOTIFY' | 'TAILOR_RESUME' | 'CLASSIFY_EMAIL' | 'SHEETS_SYNC';
  user_id: string;
  entity_id: string;
  entity_revision: number;
  settings_revision: number;
  idempotency_key: string;
}
// These interfaces document contracts only. Runtime validation is required at all boundaries.
