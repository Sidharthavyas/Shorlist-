CREATE TABLE IF NOT EXISTS personalization_state (
 user_id TEXT PRIMARY KEY REFERENCES users(id), settings_revision INTEGER NOT NULL,
 profile_revision INTEGER NOT NULL, cursor_time TEXT NOT NULL DEFAULT '', cursor_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS job_decisions (
 user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT NOT NULL REFERENCES jobs(id),
 job_revision INTEGER NOT NULL, settings_revision INTEGER NOT NULL, profile_revision INTEGER NOT NULL,
 experience_status TEXT NOT NULL, location_status TEXT NOT NULL, role_status TEXT NOT NULL,
 PRIMARY KEY(user_id,job_id)
);
CREATE INDEX IF NOT EXISTS decisions_eligible ON job_decisions(user_id,experience_status,location_status,role_status);
DROP VIEW IF EXISTS recommended_jobs;
CREATE VIEW recommended_jobs AS
SELECT j.*,u.id user_id,
 pd.experience_status member_experience_status,pd.location_status member_location_status,pd.role_status member_role_status,
 CASE WHEN m.job_revision=j.revision AND m.settings_revision=s.revision AND m.profile_revision=p.revision THEN m.score ELSE NULL END match_score
FROM jobs j CROSS JOIN users u
JOIN settings s ON s.user_id=u.id LEFT JOIN profiles p ON p.user_id=u.id
LEFT JOIN job_matches m ON m.job_id=j.id AND m.user_id=u.id
LEFT JOIN job_dispositions d ON d.job_id=j.id AND d.user_id=u.id
LEFT JOIN job_decisions pd ON pd.job_id=j.id AND pd.user_id=u.id AND pd.job_revision=j.revision AND pd.settings_revision=s.revision AND pd.profile_revision=p.revision
WHERE j.availability='OPEN' AND COALESCE(d.status,'NEW')<>'IGNORED' AND (
 (u.id='primary-owner' AND j.experience_status='ELIGIBLE' AND j.role_status='ELIGIBLE' AND j.location_status='COMPATIBLE' AND j.decision_settings_revision=s.revision AND (j.experience_min IS NULL OR j.experience_min<=s.maximum_experience) AND (j.experience_max IS NULL OR j.experience_max<=s.maximum_experience))
 OR (u.id<>'primary-owner' AND pd.experience_status='ELIGIBLE' AND pd.role_status='ELIGIBLE' AND pd.location_status='COMPATIBLE' AND NOT EXISTS(SELECT 1 FROM job_source_refs r WHERE r.job_id=j.id AND r.source_id='manual'))
);
