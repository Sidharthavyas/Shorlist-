# Setup and deployment

The current Vercel + MongoDB deployment is documented in [Vercel and MongoDB deployment](vercel.md). The Cloudflare-only instructions below describe the original alternative architecture; production currently uses MongoDB for private files and the owner session login.

## Local preview

Use Node 24 and the locked package dependencies. Run `npm ci --cache ./work/npm-cache`, then `npm start`. The preview automatically creates isolated local sample data and serves the dashboard on port 5173 and API on 8787. It never seeds production. Stop a previous preview before restarting it.

Optional local secrets belong in the ignored `.dev.vars` file. `.env.example` lists the accepted variable names. The preview reads only allowlisted source, Telegram and Google secrets. Restart after changes. Local authentication bypass is restricted to APP_ENV local and loopback hostnames.

`npm run dev` starts the complete local stack, including an API health check before showing the frontend. For frontend hot reload, use `npm run dev:api` and `npm run dev:web` in separate terminals. For direct Wrangler development use `npx wrangler dev --env local --port 8787` after `npm run db:migrate` and optional `npm run db:seed`. The standalone preview and Wrangler may use distinct local storage namespaces. The preview avoids this Windows sandbox's native esbuild file-resolution restriction.

## Cloudflare account resources

In a normal terminal authenticated to your account:

```powershell
npx wrangler login
npx wrangler d1 create job-search-os
npx wrangler r2 bucket create job-search-os-private
npx wrangler queues create job-search-os-tasks
npx wrangler queues create job-search-os-dlq
```

Replace the top-level D1 UUID in `wrangler.jsonc` with the returned ID. Verify the bucket and queue names. Use independent resources for staging. Add your custom domain through the Workers dashboard or Wrangler routes; set APP_ORIGIN to that exact origin, without a trailing slash.

Configure a Cloudflare Access self-hosted application over the entire hostname, including assets and API, with an allow policy for the owner only. Set ACCESS_ISSUER and ACCESS_AUDIENCE. Keep workers_dev and preview_urls disabled. Store the owner secret and apply production migrations:

```powershell
npx wrangler secret put OWNER_EMAIL
npx wrangler d1 migrations apply DB --remote
```

Do not run the sample seed against production. Production starts with an empty owner profile.

## Telegram

Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID with `npx wrangler secret put NAME`, start the bot conversation yourself, then enable notifications in Settings. FREEHIRE_API_KEY is optional for the personal public endpoint. Keep every secret out of frontend variables and source control.

## Google

Create a Google Cloud web OAuth client, enable Gmail and Sheets APIs and configure your consent screen/test user. Register exactly `https://YOUR_DOMAIN/api/v1/integrations/google/callback`. For local testing register `http://127.0.0.1:5173/api/v1/integrations/google/callback` separately.

Store GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_TOKEN_ENCRYPTION_KEY using Worker Secrets. The encryption secret must be independently generated and at least 32 characters. Changing it requires reconnecting or migrating encrypted credentials.

Connect each service from Settings → Integrations. Gmail requests read-only access; no email is sent. Sheets requests spreadsheet access, and the owner enters an existing spreadsheet ID. Dedicate the Shortlist tab to this application; it rewrites a stable-ID snapshot using RAW values. D1 remains authoritative. Test token refresh and disconnection with your actual account before enabling unattended use.

## Validation and release

```powershell
npm test
npm run build
npm run test:integration
npm run check:deploy
npm run deploy
```

The schedule is declared as a 15-minute Cron in Wrangler; a UI preference cannot reschedule infrastructure by itself. This environment successfully built the frontend and Worker and ran actual Workers tests, but Wrangler dry-run failed on its native esbuild file resolver. Run deployment in a normal developer terminal if that restriction persists. No live deployment has been performed.

Before relying on production, verify Access owner/non-owner behavior, a bounded real FreeHire sync, rejection/review isolation, resume downloads, manual application tracking and controlled Telegram delivery. Validate Google connections separately. Configure D1 backup/recovery, private R2 retention, queue dead-letter monitoring and operational alerts in your account.

