-- Completed outbox history must not be scanned by every dispatcher invocation.
CREATE INDEX IF NOT EXISTS outbox_open_work ON outbox(available_at,dispatch_until,dispatched_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS durable_work_leased ON durable_work(state,lease_until);
CREATE INDEX IF NOT EXISTS jobs_discovery ON jobs(is_sample,availability,role_status,experience_status,location_status,first_seen_at DESC,id);
CREATE INDEX IF NOT EXISTS jobs_updated ON jobs(updated_at,id);
CREATE INDEX IF NOT EXISTS source_ref_job ON job_source_refs(job_id,source_id);
CREATE INDEX IF NOT EXISTS history_application ON application_status_history(application_id,to_status);
CREATE INDEX IF NOT EXISTS resumes_owner ON resumes(user_id,deleted_at,created_at DESC);
