# Vercel and MongoDB deployment

Shortlist runs at https://shortlist-six-gold.vercel.app. The React frontend and API proxy run on Vercel. A Cloudflare Worker runs the application with D1 for relational records and Queues for background tasks. Production file storage uses MongoDB Atlas through a private Vercel storage endpoint; it has no R2 subscription requirement. Local tests can still use Miniflare's isolated R2 emulator.

## Owner access

Open `/api/auth/login` on the Vercel site. The deployment's generated owner password is saved locally in the ignored `work/shortlist-owner-login.txt`. Keep this file private. A successful login creates an eight-hour signed cookie with HttpOnly, Secure and SameSite=Strict. Mutations require the configured frontend origin. Password guessing is limited atomically in D1. Direct Worker requests require the server-only proxy secret as well as an owner session. To rotate credentials, update the Worker secrets and clear existing sessions by rotating OWNER_SESSION_SECRET.

## MongoDB

Use an Atlas database user with read/write permission on the `shortlist` database. The connection URI uses `/shortlist?retryWrites=true&w=majority&appName=Shortlist`; URL-encode password characters. MongoDB creates the database and `private_files` collection on the first successful write. It stores resume binaries and source snapshots as private BSON documents keyed by a SHA-256 digest of their object key. Each object is limited to 4 MB and uploaded master resumes to 3.5 MB, allowing multipart overhead within Vercel's request limits.

Set these Vercel production environment variables through the CLI or dashboard:

- MONGODB_URI: complete Atlas connection string; never use a VITE_ prefix.
- MONGODB_DATABASE: optional; defaults to `shortlist`.
- MONGO_STORAGE_SECRET: shared only with the Worker storage adapter.
- SHORTLIST_BACKEND_URL: deployed Worker HTTPS origin.
- DEPLOYMENT_PROXY_SECRET: shared only with the Worker request guard.

Atlas network access must allow the deployed Vercel functions to connect. A local successful connection alone does not prove that the hosted connection is permitted; verify a hosted upload and download before considering setup complete.

Worker secrets are OWNER_EMAIL, OWNER_PASSWORD_HASH (SHA-256 of the generated high-entropy password), OWNER_SESSION_SECRET, DEPLOYMENT_PROXY_SECRET and MONGO_STORAGE_SECRET. Production MONGO_STORAGE_URL points at the Vercel site's `/api/storage`. The raw MongoDB URI stays on Vercel, not in the Worker or browser bundle.

The private storage endpoint authenticates before opening a database connection. It exposes no public read URL and never returns driver errors or connection strings. Existing Cloudflare Access authentication remains supported for deployments without the proxy mode.

## Deploy and verify

Keep the Vercel project root at the repository root. `vercel.json` supplies npm install/build settings, SPA routing and the private storage route. Pushes to main automatically deploy the Vercel app. Worker changes need a separate Worker deployment.

```powershell
npm test
npm run build
npm run test:integration
npm run deploy:worker
```

`scripts/deploy-cloudflare.mjs` uploads the prebuilt Worker via the official API, preserves existing secrets and configures its queue consumer and schedule. Authenticate Wrangler first or set CLOUDFLARE_API_TOKEN; its local ignored OAuth file is also supported. Production migrations must be applied before deployment. No sample seed is used in production.

The sync schedule is kept empty while production storage is disconnected. Once hosted MongoDB writes/reads work, set the cron in wrangler.jsonc to `*/15 * * * *` and redeploy the Worker. Verify real source sync, PDF/DOCX uploads, profile verification, generated resume downloads and owner/non-owner requests. Telegram and Google remain optional integrations requiring their own secrets.

Do not upload `work`, `.wrangler`, `.vercel`, `.dev.vars`, `.env`, raw resumes, local databases or login credentials to GitHub. The private URI input file is `work/mongodb-uri.txt`; it is never part of source deployments.
