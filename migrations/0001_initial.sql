-- UTC timestamps are ISO-8601 TEXT. IDs are application-generated UUIDs.
-- Apply through Wrangler migrations; D1 batch handles application transactions.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY, access_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json)), updated_at TEXT NOT NULL
);
CREATE TABLE settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 1,
  maximum_experience REAL NOT NULL DEFAULT 2 CHECK(maximum_experience BETWEEN 0 AND 2),
  minimum_match_score INTEGER NOT NULL DEFAULT 70 CHECK(minimum_match_score BETWEEN 0 AND 100),
  data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json)), updated_at TEXT NOT NULL
);
CREATE TABLE companies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
  domain TEXT, created_at TEXT NOT NULL
);
CREATE INDEX companies_name ON companies(normalized_name);
CREATE TABLE job_sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json))
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, company_id TEXT REFERENCES companies(id), company TEXT NOT NULL,
  title TEXT NOT NULL, normalized_title TEXT NOT NULL, description TEXT NOT NULL,
  requirements_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(requirements_json)),
  location TEXT NOT NULL DEFAULT '',
  remote_type TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(remote_type IN ('WORLDWIDE_REMOTE','INDIA_REMOTE','REMOTE','HYBRID','ONSITE','UNKNOWN')),
  allowed_countries_json TEXT CHECK(allowed_countries_json IS NULL OR json_valid(allowed_countries_json)),
  location_status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK(location_status IN ('COMPATIBLE','INCOMPATIBLE','REVIEW_REQUIRED')),
  location_reason TEXT NOT NULL DEFAULT '',
  role_status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK(role_status IN ('ELIGIBLE','NOT_ELIGIBLE','REVIEW_REQUIRED')),
  role_reason TEXT NOT NULL DEFAULT '',
  experience_status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK(experience_status IN ('ELIGIBLE','NOT_ELIGIBLE','REVIEW_REQUIRED')),
  experience_min REAL, experience_max REAL,
  job_url TEXT NOT NULL, apply_url TEXT, canonical_apply_url TEXT,
  fingerprint TEXT NOT NULL, salary_json TEXT CHECK(salary_json IS NULL OR json_valid(salary_json)),
  employment_type TEXT, seniority TEXT,
  availability TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(availability IN ('OPEN','CLOSED','EXPIRED','UNKNOWN')),
  posted_at TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  last_verified_at TEXT, closed_at TEXT, content_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, decision_settings_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(experience_min IS NULL OR experience_min >= 0),
  CHECK(experience_max IS NULL OR experience_max >= 0),
  CHECK(experience_min IS NULL OR experience_max IS NULL OR experience_min <= experience_max),
  CHECK(experience_status <> 'ELIGIBLE' OR ((experience_min IS NULL OR experience_min <= 2) AND (experience_max IS NULL OR experience_max <= 2)))
);
CREATE INDEX jobs_apply_url ON jobs(apply_url);
CREATE INDEX jobs_canonical_apply_url ON jobs(canonical_apply_url);
CREATE INDEX jobs_fingerprint ON jobs(fingerprint);
CREATE INDEX jobs_company ON jobs(company);
CREATE INDEX jobs_title ON jobs(normalized_title);
CREATE INDEX jobs_discovery ON jobs(experience_status,role_status,location_status,availability,first_seen_at DESC,id);
CREATE TABLE job_source_refs (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
  source_id TEXT NOT NULL REFERENCES job_sources(id), external_id TEXT NOT NULL,
  public_slug TEXT, source_url TEXT NOT NULL, source_apply_url TEXT,
  snapshot_key TEXT, content_hash TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  UNIQUE(source_id, external_id)
);
CREATE UNIQUE INDEX source_slug ON job_source_refs(source_id,public_slug) WHERE public_slug IS NOT NULL;
CREATE INDEX source_refs_job ON job_source_refs(job_id);
CREATE TABLE job_experience_analysis (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), job_revision INTEGER NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('ELIGIBLE','NOT_ELIGIBLE','REVIEW_REQUIRED')),
  min_years REAL, max_years REAL, confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  reason TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  parser_version TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('DETERMINISTIC','LLM','MANUAL')),
  created_at TEXT NOT NULL
);
CREATE INDEX experience_job ON job_experience_analysis(job_id,job_revision);
CREATE TABLE job_skills (
  job_id TEXT NOT NULL REFERENCES jobs(id), skill TEXT NOT NULL,
  requirement_type TEXT NOT NULL CHECK(requirement_type IN ('REQUIRED','PREFERRED','MENTIONED')),
  evidence TEXT NOT NULL, PRIMARY KEY(job_id,skill,requirement_type)
);
CREATE INDEX skill_search ON job_skills(skill,job_id);
CREATE TABLE job_matches (
  user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT NOT NULL REFERENCES jobs(id),
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  breakdown_json TEXT NOT NULL CHECK(json_valid(breakdown_json)),
  analysis_json TEXT NOT NULL CHECK(json_valid(analysis_json)),
  profile_revision INTEGER NOT NULL, settings_revision INTEGER NOT NULL, job_revision INTEGER NOT NULL,
  engine_version TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,job_id)
);
CREATE INDEX match_score ON job_matches(user_id,score DESC);
CREATE TABLE job_dispositions (
  user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','SAVED','IGNORED')),
  notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(user_id,job_id)
);
CREATE INDEX disposition_status ON job_dispositions(user_id,status);
CREATE TABLE duplicate_candidates (
  job_id TEXT NOT NULL REFERENCES jobs(id), candidate_job_id TEXT NOT NULL REFERENCES jobs(id),
  reason TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','MERGED','DISTINCT')),
  PRIMARY KEY(job_id,candidate_job_id), CHECK(job_id <> candidate_job_id)
);
CREATE TABLE resumes (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT REFERENCES jobs(id),
  kind TEXT NOT NULL CHECK(kind IN ('MASTER','TAILORED')), created_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE(id,user_id)
);
CREATE TABLE resume_versions (
  id TEXT PRIMARY KEY, resume_id TEXT NOT NULL REFERENCES resumes(id), user_id TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('PENDING','RUNNING','READY','FAILED')),
  pdf_key TEXT, docx_key TEXT, original_key TEXT, content_hash TEXT,
  profile_revision INTEGER, job_revision INTEGER, template_version TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_json)),
  content_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(content_json)),
  changes_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(changes_json)),
  idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(resume_id,version), UNIQUE(user_id,idempotency_key), UNIQUE(id,user_id),
  FOREIGN KEY(resume_id,user_id) REFERENCES resumes(id,user_id)
);
CREATE TABLE profile_facts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), resume_version_id TEXT,
  category TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), verified_at TEXT,
  verified_by TEXT REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(resume_version_id,user_id) REFERENCES resume_versions(id,user_id)
);
CREATE TABLE applications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT NOT NULL REFERENCES jobs(id),
  resume_version_id TEXT, apply_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('NEW','SAVED','REVIEW','APPLYING','APPLIED','APPLICATION_CONFIRMED','ONLINE_ASSESSMENT','RECRUITER_RESPONSE','INTERVIEW','TECHNICAL_INTERVIEW','FINAL_ROUND','OFFER','REJECTED','WITHDRAWN','CLOSED')),
  applied_at TEXT, last_response_at TEXT, next_follow_up_at TEXT, notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1, transition_actor TEXT NOT NULL,
  transition_reason TEXT NOT NULL, transition_event_key TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(user_id,job_id), UNIQUE(id,user_id),
  FOREIGN KEY(resume_version_id,user_id) REFERENCES resume_versions(id,user_id)
);
CREATE INDEX application_status ON applications(user_id,status);
CREATE INDEX application_applied ON applications(user_id,applied_at);
CREATE TABLE application_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id TEXT NOT NULL REFERENCES applications(id),
  from_status TEXT, to_status TEXT NOT NULL, actor TEXT NOT NULL,
  reason TEXT NOT NULL, event_key TEXT NOT NULL, occurred_at TEXT NOT NULL,
  UNIQUE(application_id,event_key)
);
CREATE TRIGGER application_created AFTER INSERT ON applications BEGIN
  INSERT INTO application_status_history(application_id,from_status,to_status,actor,reason,event_key,occurred_at)
  VALUES(NEW.id,NULL,NEW.status,NEW.transition_actor,NEW.transition_reason,NEW.transition_event_key,NEW.updated_at);
END;
CREATE TRIGGER application_status_changed AFTER UPDATE OF status ON applications
WHEN OLD.status <> NEW.status BEGIN
  INSERT INTO application_status_history(application_id,from_status,to_status,actor,reason,event_key,occurred_at)
  VALUES(NEW.id,OLD.status,NEW.status,NEW.transition_actor,NEW.transition_reason,NEW.transition_event_key,NEW.updated_at);
END;
CREATE TRIGGER history_no_update BEFORE UPDATE ON application_status_history BEGIN
  SELECT RAISE(ABORT,'Status history is append-only');
END;
CREATE TRIGGER history_no_delete BEFORE DELETE ON application_status_history BEGIN
  SELECT RAISE(ABORT,'Status history is append-only');
END;
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT REFERENCES jobs(id),
  application_id TEXT, channel TEXT NOT NULL, event_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING','SENDING','SENT','FAILED','UNKNOWN')),
  provider_message_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT, created_at TEXT NOT NULL, sent_at TEXT,
  UNIQUE(user_id,channel,event_key),
  FOREIGN KEY(application_id,user_id) REFERENCES applications(id,user_id)
);
CREATE TABLE email_events (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), provider_message_id TEXT NOT NULL,
  application_id TEXT, classification TEXT NOT NULL,
  confidence REAL CHECK(confidence BETWEEN 0 AND 1), state TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
  provider_occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json)),
  UNIQUE(user_id,provider_message_id),
  FOREIGN KEY(application_id,user_id) REFERENCES applications(id,user_id)
);
CREATE TABLE source_sync_state (
  source_id TEXT PRIMARY KEY REFERENCES job_sources(id), last_completed_at TEXT,
  window_start TEXT, run_started_at TEXT, cursor TEXT, lease_token TEXT, lease_until TEXT,
  next_retry_at TEXT, last_error_code TEXT,
  counters_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(counters_json))
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
  entity_id TEXT NOT NULL, entity_revision INTEGER NOT NULL, idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING','RUNNING','READY','FAILED','STALE')),
  lease_token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)), error_code TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,idempotency_key)
);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), available_at TEXT NOT NULL,
  dispatched_at TEXT, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending ON outbox(available_at) WHERE dispatched_at IS NULL;
CREATE TABLE idempotency_records (
  user_id TEXT NOT NULL REFERENCES users(id), route TEXT NOT NULL, key TEXT NOT NULL,
  request_hash TEXT NOT NULL, response_status INTEGER, response_json TEXT,
  expires_at TEXT NOT NULL, PRIMARY KEY(user_id,route,key)
);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
  before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json)), created_at TEXT NOT NULL
);
CREATE TABLE integration_state (
  user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL,
  encrypted_credentials TEXT, cursor TEXT,
  data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json)), updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,provider)
);

-- Owner-aware view: queries MUST still bind user_id to the authenticated owner.
-- Settings-version equality hides stale eligibility after preference changes.
CREATE VIEW recommended_jobs AS
SELECT j.*, u.id AS user_id,
  CASE WHEN m.job_revision = j.revision AND m.settings_revision = s.revision
    AND m.profile_revision = p.revision THEN m.score ELSE NULL END AS match_score
FROM jobs j CROSS JOIN users u
JOIN settings s ON s.user_id = u.id
LEFT JOIN profiles p ON p.user_id = u.id
LEFT JOIN job_matches m ON m.job_id = j.id AND m.user_id = u.id
LEFT JOIN job_dispositions d ON d.job_id = j.id AND d.user_id = u.id
WHERE j.experience_status = 'ELIGIBLE' AND j.role_status = 'ELIGIBLE'
  AND j.location_status = 'COMPATIBLE' AND j.availability = 'OPEN'
  AND j.decision_settings_revision = s.revision
  AND (j.experience_min IS NULL OR j.experience_min <= s.maximum_experience)
  AND (j.experience_max IS NULL OR j.experience_max <= s.maximum_experience)
  AND COALESCE(d.status,'NEW') <> 'IGNORED';
