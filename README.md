# Shortlist — Personal Job Search OS

Status: working local application with React and a Cloudflare Worker. The frontend and owner-authenticated backend are deployed. Hosted MongoDB storage, private resume upload/download and live job ingestion have passed acceptance checks. This is not yet a complete production-ready implementation of every feature in the original brief.

## Run the application

Requires Node.js 24. In this directory run:

```powershell
npm ci --cache ./work/npm-cache
npm start
```

Open http://127.0.0.1:5173. The API uses the actual Cloudflare workerd/Miniflare runtime on port 8787. Demo records are hidden from normal results, and their external application links are disabled. No notifications are sent by default. Click Sync real jobs to fetch public FreeHire records; pagination continues through the queue until complete or rate-limited. Local preview does not run an automatic cron. Restart after backend changes.

After uploading a resume, open Settings → Verified profile → Import from uploaded resume. Review the draft and click Verify & save profile. Uploading stores/extracts the original; it does not automatically verify facts or fetch jobs. Existing saved profile fields are preserved during import.

`npm run dev` also starts both services through this combined runner. For frontend hot reload, start `npm run dev:api` in one terminal and `npm run dev:web` in another. Running `dev:web` alone requires an already running API on port 8787.

## Implemented application

React Overview, Discover, Job Detail, Applications, Resumes, Analytics, Settings and a separate Review view; FreeHire structured ingestion; hard experience and location gates; source dedupe and snapshots; match scoring; save/ignore/restore and manual job entry; editable verified profile; PDF/DOCX upload and text extraction; factual on-demand PDF/DOCX generation in R2; resume selection and comparison; application Kanban, status history, notes and CSV export. The backend also contains follow-up APIs and optional Google OAuth/Gmail/Sheets and Telegram integration code.

```powershell
npm test
npm run build
npm run test:integration
```

Integration checks use disposable data and mocked identity keys; they do not send live provider messages. See [setup and deployment](docs/setup.md) and [implementation status and limitations](docs/status.md). The following architecture documents describe the original design; some API details differ from the implementation.

Start with `docs/architecture.md`, then `docs/api.md` and `docs/phase-1.md`.

## Included

- Architecture, security model, ingestion and recovery design.
- Proposed repository structure and staged implementation plan.
- Executable SQLite/D1 schema: `migrations/0001_initial.sql`.
- Cloudflare binding template: `wrangler.example.json`.
- Shared domain contracts: `contracts/domain.ts`.
- Default settings and secret names.
- Local schema verification: `node tests/schema.mjs` (Node 24).

## Intended stack

React, TypeScript, Vite, Tailwind, Hono, Cloudflare Workers, D1, R2, Queues, Cron and Access. One owner, one same-origin dashboard/API deployment. No additional database, container or Python service is required for Phase 1.

## Before deployment

Create Cloudflare resources, replace example identifiers, implement and test the runtime and frontend, configure Access for the owner and custom domain, set Worker Secrets, apply migrations in staging, then verify the end-to-end release gates in the plan. Never deploy the template as an operational service.

Future resume rendering must pass factual and PDF/DOCX compatibility tests in Workers before selecting its libraries. Gmail and Sheets require separate Google OAuth setup; a connected chat plugin is not an unattended backend credential.

## References checked 2026-10-23

- [FreeHire API](https://freehire.me/docs/api)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Worker static asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Queue retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)

## More job sources

After updating, restart with `npm run dev`, then click **Sync real jobs**. It now covers FreeHire, Himalayas, Jobicy, Remotive and the configured Greenhouse/Lever/Ashby company boards. Manage the company watchlist in **Settings → Integrations**. Apply migrations when upgrading production. No paid API key is needed for these public feeds. Provider-specific intervals apply, so repeated clicks can legitimately fetch nothing new. Discover defaults to best-match sorting and supports a source filter. Match details show role patterns and verified skill overlap. See `docs/status.md` for operating limits and validation.

## Application helper extension

The Chrome/Edge extension is in `extensions/shortlist-autofill`. Build/package with `node scripts/package-extension.mjs` (also part of `npm run build`). Install and use it through Settings → Verified profile → Fill applications faster. Extract the ZIP, enable Developer mode in your browser's Extensions page and choose Load unpacked. Import your saved profile from the dashboard tab or exported JSON, then preview/fill fields on an application. Choose the role's PDF/DOCX resume if you want to attach it. See the extension README for supported fields and limitations. Installation remains a manual browser step.

## Vercel

Frontend preview: https://shortlist-six-gold.vercel.app

`vercel.json` configures the frontend, authenticated API proxy and private MongoDB storage endpoint. Cloudflare D1 and Queues run the backend. See [Vercel deployment](docs/vercel.md) before importing this repository.





## Company coverage

The company directory retains all 470 supplied companies. Public feeds verified on 28 October 2026 connect 79 of those companies through 83 company boards; Arbeitnow and Remote OK add two broader public feeds. Existing boards remain available. Settings → Integrations includes company search, platform search, connection status, sync controls and official careers links. Custom and blocked portals are clearly marked for manual checks and do not count as automatic job coverage. A public source check does not certify every employer or guarantee a suitable vacancy.

New adapters cover Workday, SmartRecruiters (PUBLIC postings only), Workable, Arbeitnow and Remote OK. Workday and SmartRecruiters fetch full descriptions before matching, continue all engineer/developer/automation query pages, and process ten details per page. Location and experience checks remain conservative. Sources refresh every 6–12 hours, with due sources dispatched in batches of twelve per sweep to respect free-tier limits. Initial ingestion finishes in the background and can take time.

Apply `migrations/0005_company_sources.sql` before deploying this release. The migration preserves disabled-source preferences; local preview upgrades automatically. Catalog evidence is in `config/company-coverage.json` and verified mappings in `config/company-feeds.json`. To recheck the public sites locally, run `node scripts/test.mjs --compile-only` then `node scripts/discover-companies.mjs`. Cached discovery/probe results live in ignored `work/`; remove those specific JSON files if a full fresh check is needed. Review regenerated mappings before applying an updated migration. Source attribution links are retained for Arbeitnow and Remote OK.


## Personal accounts and database operation

Share the website and let each person create an account at `/api/auth/signup`. They receive a private profile, preferences, resume library and application tracker. The existing owner remains the administrator for shared sources. MongoDB stores account credentials; D1 stores workspace data and shared jobs. New-account secrets are server-only Vercel variables, and the Worker enables `MULTI_USER`. Email verification and email password recovery are not configured.

The 28 October database read incident, code findings, indexes, polling reductions, reset handling and account-isolation tests are documented in [read-budget-and-accounts.md](docs/read-budget-and-accounts.md). Discovery resumes at the configured reset time; do not remove the pause merely to retry a blocked database. The first successful initialization automatically applies the pending workspace/index schema. No paid plan is required or activated by this release.
