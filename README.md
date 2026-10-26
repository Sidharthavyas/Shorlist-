# Shortlist — Personal Job Search OS

Status: working local application with React and a Cloudflare Worker. Deployment and live provider verification are still pending. This is not yet a complete production-ready implementation of every feature in the original brief.

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

After updating, restart with `npm run dev`, then click **Sync real jobs**. It now covers FreeHire, Himalayas, Jobicy, Remotive and the configured Greenhouse/Lever/Ashby company boards. Manage the company watchlist in **Settings → Integrations**. No new migration or paid API key is needed for these public feeds. Provider-specific intervals apply, so repeated clicks can legitimately fetch nothing new. Discover defaults to best-match sorting and supports a source filter. Match details show role patterns and verified skill overlap. See `docs/status.md` for operating limits and validation.

## Application helper extension

The Chrome/Edge extension is in `extensions/shortlist-autofill`. Build/package with `node scripts/package-extension.mjs` (also part of `npm run build`). Install and use it through Settings → Verified profile → Fill applications faster. Extract the ZIP, enable Developer mode in your browser's Extensions page and choose Load unpacked. Import your saved profile from the dashboard tab or exported JSON, then preview/fill fields on an application. Choose the role's PDF/DOCX resume if you want to attach it. See the extension README for supported fields and limitations. Installation remains a manual browser step.

## Vercel

`vercel.json` configures the frontend build and SPA routes. The production backend still needs provisioning and authentication; until connected, API requests deliberately return HTTP 503. See [Vercel deployment](docs/vercel.md) before importing this repository.
