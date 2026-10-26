# Vercel deployment

The repository includes a Vercel configuration for the React frontend: Node 24, repository root, `npm ci`, `npm run build`, output `apps/web/dist`, and SPA deep links. Import `Sidharthavyas/Shorlist-` after the source is pushed. Keep the root directory at the repository root.

**This is currently a frontend deployment, not an operational hosted job application.** API requests return a clear, non-cacheable HTTP 503 until the production backend is connected. The deployed site does not read your local jobs, uploaded resumes, profile, or credentials. The extension ZIP can still be downloaded.

The backend in `apps/worker` depends on Cloudflare D1, private R2 storage, Queues, scheduled triggers and Cloudflare Access. Vercel does not provide those bindings to this Worker. Follow `setup.md` to provision the backend. Do not upload `.wrangler`, `.dev.vars`, `work`, or local databases to GitHub or Vercel.

Before making this a working production deployment:

1. Create the Cloudflare resources and set their real IDs in `wrangler.jsonc`.
2. Configure the owner-only Access application, Worker secrets and production migrations.
3. Choose the authentication path for the Vercel frontend and Cloudflare API. The existing Worker requires a valid owner Access JWT; a plain rewrite to a protected Worker does not establish a browser session across domains. A shared custom domain protected by Cloudflare Access requires configuring and verifying that protection on the frontend as well as the API.
4. Replace the `/api` unavailable route with the authenticated backend connection only after testing owner and non-owner requests, mutation origin checks, uploads, queue jobs and downloads. Set `APP_ORIGIN` to the actual frontend origin and update Google OAuth callback configuration if enabled.

Alternatively, port the API to Vercel with a persistent database, private object storage, background execution and owner authentication. This is a backend migration, not a Vercel build setting.

Until those steps are complete, a Vercel URL is a frontend preview. Do not seed or expose your local personal database as a public API.
