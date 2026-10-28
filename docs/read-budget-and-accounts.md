# Database read incident and personal workspaces

The account exhausted D1's 5,000,000 rows-read daily allowance on 28 October 2026. This is a row-scan allowance, not a CPU-time invoice. Cloudflare counts scanned rows, including rows filtered out. Its daily free allowance resets at 00:00 UTC (05:30 IST). No paid plan was enabled by this change.

## Code paths contributing unnecessary work

- Source settings polled every four seconds. Explicit sync polled every 1.5 seconds. Each status request counted all source references.
- The Vercel proxy also woke up to eight background drain requests after successful GETs for sources, summary and task status. Each drain called the outbox dispatcher.
- The outbox query could scan completed task history. Its old partial index only covered undispatched rows; the recovery query also considered dispatched rows.
- Every profile save requeued every stored job with a new random idempotency key, even for jobs that could never match.
- Every authenticated API request repeated the initial user/settings/source bootstrap statements.

These are verified code paths, not a measured percentage attribution from query-level production logs. A local SQLite EXPLAIN regression test confirms `SCAN outbox` before the new migration and an indexed search using `outbox_open_work` afterward.

## Applied controls

GET requests no longer start queue processing. Source settings have an explicit refresh button and no idle polling loop. Explicit sync uses a bounded twenty checks at ten-second intervals and follows only the feeds actually queued. User initialization is memoized per binding/user. Profile reanalysis uses eligible jobs and deterministic deduplication. Ineligible source jobs remain available for explicit resume generation without producing pointless analysis tasks.

Migration 0006 adds unfinished-outbox, leased-work, discovery, updated-job, source-reference, history and private-resume indexes. Background discovery is paused until 29 October 00:00 UTC. The five-minute schedule checks the pause before touching D1 and resumes afterward; source sweeps remain limited to twelve due feeds per fifteen-minute window. The application returns a clear retry time when D1 blocks reads and avoids repeating D1 calls in that isolate until the reset.

Migrations 0006 and 0007 are also embedded in `config/workspace-schema.json`. With MULTI_USER enabled, the first successful database initialization applies them atomically if the workspace schema is absent. This allows the already-exhausted production database to recover automatically after its allowance resets. Normal migration commands remain safe to apply later. Keep the embedded JSON synchronized when changing these two SQL files.

## Accounts and isolation

Vercel serves `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` and `/api/auth/session`. MongoDB stores account credentials with per-account salts and scrypt password hashes, a unique email index, and expiring per-IP/per-email attempt counters. Existing owner login remains valid. Cookies remain HttpOnly, Secure, SameSite=Strict, with the requested one-year duration. Mutations require the canonical Origin. OWNER_SESSION_SECRET, OWNER_PASSWORD_HASH and OWNER_EMAIL must be server-only variables in both Vercel and the Worker; MONGODB_URI stays in Vercel only.

Every signed member gets their own D1 user, verified profile, preferences, matches, applications, resume metadata, files and task access. Background resume processing restores the task's user context from its database row. Resume identifiers include the user ID. Source administration, shared-job corrections and existing owner-added manual listings remain owner-only. Notifications using the owner's Telegram credentials cannot run for a member. Public signup does not verify email ownership or implement email-based password recovery; no email service is configured.

Member matching walks an indexed catalog cursor in twenty-row batches, with up to twenty existing likely fits processed first on a new profile/preferences revision. It stores per-user decisions and scores, not changes to shared jobs. Continued matching is polled only while needed and stops on errors. Existing owner data and the original conservative 0–2-year discovery rules remain intact.

Validation includes separate Alice/Bob profiles, preferences, trackers, concurrent resume generation, private file/task access, rejection of foreign resume IDs, shared-source administration restrictions, and protection of owner manual listings. Production account registration can operate while D1 is blocked, but profiles, jobs, resumes and tracker operations cannot complete until D1 reads resume. The 470-company catalog and 93 configured sources are present; initial added-source ingestion is deferred by the same pause.
