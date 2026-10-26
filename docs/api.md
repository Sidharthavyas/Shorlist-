# API contract

All routes use `/api/v1`, owner authentication and owner-scoped queries. Internal scheduled/queue handlers are not public HTTP endpoints. JSON schemas will validate runtime inputs and generate OpenAPI during Phase 1; this document defines the initial contract, not an implemented API.

Success: `{ "data": ... }`; lists add `meta: { next_cursor, limit }`. Errors: `{ "error": { "code", "message", "request_id", "details" } }`, without sensitive internals. UTC ISO-8601 timestamps; UUID IDs. Return 400 invalid input, 401 invalid identity, 403 non-owner/Origin, 404 missing owned resource, 409 version/idempotency conflict, 413 size limit, 422 domain violation, 429 throttled and 503 temporary upstream failure. Bound lists to 100; opaque keyset cursor includes the sort and filter hash. Reject mismatched cursors.

Mutating create/task requests require `Idempotency-Key`; bind it to owner, route and request hash. Same key/body returns the original response; changed body conflicts. Versioned edits require `If-Match` revision and return 409 on stale state. No GET mutates anything. Audit actor and reason on manual corrections.

| Phase | Method and route | Contract |
| --- | --- | --- |
| 1 | GET /health | Authenticated service/config status; no secrets |
| 1 | GET /summary | New eligible today, review counts, sync status; future metrics null with capability flag |
| 1 | GET /jobs | Open eligible compatible recommendations only |
| 1 | GET /jobs/:id | Full normalized job, decision evidence, source refs, score null/pending |
| 1 | GET /review/jobs | Ambiguous jobs, clearly separated from recommendations |
| 1 | GET /sources | Source health, pending/resumed run, last completion, counts |
| 1 | POST /sources/:id/sync | 202 task/run ID; owner-triggered bounded sync, returns existing active run |
| 2 | GET/PATCH /settings | Validated settings plus revision; reject experience maximum >2 |
| 2 | PATCH /jobs/:id/disposition | NEW/SAVED/IGNORED, restore via NEW |
| 2 | POST /jobs | Manual structured job; same gate/dedupe pipeline; 201 or existing master |
| 2 | POST /jobs/:id/corrections | Evidence-backed experience/role/location/score correction; audited; cannot bypass cap |
| 2 | GET /notifications | Intent/delivery state, including UNKNOWN |
| 3 | GET/PUT /profile | Structured profile, verified skills and fact references |
| 3 | POST /profile/uploads | Bounded multipart PDF/DOCX; 202 parse task; MIME/magic validation |
| 3 | POST /profile/facts/:id/verify | Approve a parsed fact with original evidence reference |
| 3 | POST /jobs/:id/resume-tasks | 202 task ID, profile revision, template ID; no auto submission |
| 3 | GET /tasks/:id | Pending/running/ready/failed and sanitized error |
| 3 | GET /resumes | Master/tailored metadata, version, job and score at creation |
| 3 | GET /resume-versions/:id/compare | Fact IDs, section/bullet ordering and wording differences |
| 3 | GET /resume-versions/:id/files/:format | Authorized streamed PDF/DOCX; private headers |
| 3 | DELETE /resumes/:id | 202 deletion task; reject referenced versions or retain audited metadata |
| 4 | POST /applications | Mark Applied: job_id, applied_at, ready resume_version_id or null, notes; one per job |
| 4 | GET /applications | Cursor list, status/search/follow-up filters |
| 4 | PATCH /applications/:id | Status/notes/next_follow_up; atomic history, optimistic version |
| 4 | GET /applications/:id/history | Ordered append-only events with actor and evidence |
| 4 | GET /analytics | Totals and grouped response/interview rates with denominators/time window |
| 4 | POST /exports/applications | 202 private CSV export; neutralize spreadsheet formula cells |
| 5 | GET /integrations/google/start | OAuth redirect; state, PKCE and exact redirect URI |
| 5 | GET /integrations/google/callback | Verify state; encrypt refresh credential; no tokens in UI |
| 5 | DELETE /integrations/google | Revoke and clear credentials/cursors |
| 5 | POST /email-events/:id/resolve | Confirm application match/classification; atomic history |
| 5 | POST /integrations/sheets/sync | 202 versioned upsert task |
| 6 | GET /follow-ups | Derived due items, no outbound mail |
| 6 | POST /applications/:id/follow-up-draft | Factual draft only; never send |

`GET /jobs` filters: `q`, `since`, `remote_type`, `role`, `technology`, `min_score`, `cursor`, `limit`. Multiple query tokens match across company/title/skills/location/description; bound query size and parameterize SQL. Omitted score filter includes unscored Phase 1 jobs; explicit `min_score` excludes unscored. The hard gate cannot be disabled with a query parameter. A separate explicit history view may show closed tracked jobs; Discover does not.

Example Phase 1 detail:

```json
{
  "data": {
    "id": "uuid", "company": "Example", "title": "Backend Developer",
    "remote_type": "INDIA_REMOTE", "availability": "OPEN",
    "experience": {
      "classification": "ELIGIBLE", "min_years": 0, "max_years": 2,
      "confidence": 0.98, "reason": "Explicit 0–2 year requirement",
      "evidence": [{ "field": "description", "quote": "0–2 years of experience" }]
    },
    "match": null, "analysis_state": "PENDING", "revision": 1,
    "skills": ["Python", "FastAPI"], "source_refs": [],
    "apply_url": "https://example.com/careers/requisition-123"
  }
}
```

UI pages: Dashboard `/`, Discover `/discover`, detail `/jobs/:id`, Applications `/applications`, Resumes `/resumes`, Analytics `/analytics`, Settings `/settings`; review `/review` is a separate utility view. Phase 1 implements the first three and source/review state, not fake later-phase functionality.
