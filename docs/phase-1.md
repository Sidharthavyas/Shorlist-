# Repository and phased implementation

## Proposed final repository

```text
apps/
  web/                  React/Vite/Tailwind; six main page routes
    src/pages/          Dashboard, Discover, JobDetail, Applications,
                        Resumes, Analytics, Settings, Review
  worker/src/
    index.ts            fetch/scheduled/queue exports
    middleware/         Access, owner, Origin, validation, errors
    routes/             versioned Hono APIs
    sources/            interface, FreeHire boundary validation/mapping
    domain/             experience, roles, location, canonical URLs
    services/           sync, outbox, availability, audit
    repositories/       prepared D1 queries and atomic batches
    tasks/              analysis and snapshot consumers
packages/contracts/     shared runtime schemas and inferred TS types
migrations/             ordered forward D1 migrations
config/                 defaults, aliases, role priority
tests/
  unit/                 parsers, location, URL normalization
  integration/          Workers runtime, D1/R2/Queues, Access
  fixtures/             sanitized versioned FreeHire wire examples
  browser/              discovery and detail workflows
docs/                   architecture, API, setup, operations, deployment
wrangler.jsonc          real resource IDs; no secrets
.dev.vars.example       local secret names; actual file ignored
```

The current `contracts/`, config and migration are design starters to move into this layout. Do not create a generic scraper or autofill extension.

## Phase 1 sequence and exit gate

1. Bootstrap strict TypeScript workspace with pinned supported dependencies and lockfile. React/Vite/Tailwind frontend, Hono Worker, Wrangler configuration and generated binding types. Configure local D1/R2/Queue emulation; Vite proxies `/api` to the Worker. Document one-command development and build.
2. Implement Access/JWKS verification and owner scope before business endpoints. Provision staging resources and apply the migration. Exercise migration and FK constraints under the actual D1 runtime, not only desktop SQLite.
3. Capture a small live FreeHire fixture and validate pagination/detail/error contracts. Implement source adapter, schema drift reporting, timeout/budget/rate-limit handling and resumable leases. No live API dependency in unit tests.
4. Implement exact identity dedupe, conservative URL canonicalization and duplicate-candidate handling. Add source-revision updates, evidence extraction and deterministic role/experience/location gates. Persist analysis and outbox atomically. Implement private snapshot tasks and outbox replay.
5. Implement list/detail/summary/review/source-health APIs. Default list uses the restrictive recommendation view; pagination, filters and counts share the same predicates. Add scheduled availability verification and downtime catch-up.
6. Build responsive Dashboard, Discover and Job Detail with loading/error/empty states. Show active 0–2 gate, remote scope, source, freshness, evidence and full description. Score is Pending until Phase 2. Apply opens a validated external link for manual submission. Include keyboard operation, accessible labels and mobile layout. Later page navigation can show explicit planned-state screens, never fabricated data.
7. Run unit, Worker integration and browser checks. Fix failures before starting Phase 2. Use live staging smoke checks with a small source budget. Verify authenticated custom-domain access and that direct/preview URLs cannot bypass Access.

## Required tests

Experience: all eight supplied role/experience acceptance examples; fresher/no-experience phrases; Unicode 0–2; 1 year; 2 preferred; 2+ required reject; 2+ preferred review; mandatory 3+ beats junior label; 0–2 plus mandatory 3 elsewhere rejects; missing experience review; months and word-number forms; degree/company-age numbers do not count; description mention of senior colleagues does not reject.

Location: worldwide, India, explicitly US-only remote, ambiguous remote, onsite/hybrid defaults and settings changes. Unknown scope never becomes worldwide by inference.

Storage and pipeline: repeated fetch idempotency; same requisition cross-source yields one master with two refs; distinct requisitions sharing a generic careers URL remain separate; source revision invalidation; rollback on failing batch; snapshot failure/retry; crash between commit and enqueue; queue redelivery; stale task revision; pagination resume after 429; overlap/downtime backfill; lease contention; closed-job suppression; no closed inference from missing search results.

Security/API: expired/wrong-audience/unsigned/missing JWT; non-owner identity; Origin failure; body limits; malformed source JSON; malicious description; SQL parameter handling; arbitrary URL rejection; owner isolation; review/rejected jobs absent even with high score.

Browser: search/filter pagination, job detail evidence, manual apply link, source attribution, empty/error states, review distinction and mobile/keyboard usability.

## Phase boundaries

| Phase | Deliverable | Required gate before moving on |
| --- | --- | --- |
| 1 | Ingestion, strict gates, Discover/detail, Cloudflare foundation | Above tests green; live staging discovery and private access verified |
| 2 | Scoring, Telegram, settings, save/ignore/restore | Score cannot bypass gate; intent dedupe, delivery ambiguity and stale revisions tested |
| 3 | Profile, master upload, verified facts, on-demand PDF/DOCX | Fabrication checks, actual render/download/R2 metadata and retry tests |
| 4 | Tracker, Kanban, history, analytics | Atomic transitions, concurrency, rates/denominators and resume binding tested |
| 5 | Gmail classification and Sheets upsert | OAuth refresh/revoke, replay, ambiguous matches and no-regression tests |
| 6 | Additional adapters, follow-ups, richer analytics | Adapter contract suite, notification intent controls, manual drafts only |

## Decisions resolved without blocking

Use the direct Cloudflare account deployment path requested by the brief; no managed Sites deployment or account resources are created in this design step. Use Asia/Kolkata for dashboard dates, UTC timestamps in storage, and a single stable owner ID. The cron schedule is infrastructure configuration; a settings frequency change must update that schedule through deployment, or select a multiple of the existing 15-minute trigger. Do not promise a UI setting alone reschedules Cron.

Outstanding setup inputs for later: Cloudflare account/domain, Access team/audience and owner identity, Telegram bot/chat credentials, verified personal profile/resume, and optional Google OAuth client. These do not block local implementation.
