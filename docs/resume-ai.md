# Optional AI resume writing

The existing Carlito/Letter PDF and DOCX renderers still control layout. AI can rephrase existing summary and achievement text and individual experience/project bullets. Section order, employment headings, dates, education, skills lists and contact headers stay under application control. The model never writes HTML, TeX, DOCX or PDF markup.

## Enable on the Cloudflare Worker

Set the following **server-only** Worker secrets/variables. These are not Vite variables and do not belong in the browser or Vercel frontend configuration.

Prefer Worker secrets for all these settings, including the model and data-policy confirmation: this project's deployment preserves secret bindings. If you choose plaintext variables instead, manage those non-key values in `wrangler.jsonc` so a later deployment does not replace them. API keys must always be secrets.

- `RESUME_AI_PROVIDER`: `gemini` (default) or `grok`.
- `GEMINI_API_KEY` or `XAI_API_KEY`: the corresponding provider key, stored as a Worker secret.
- `RESUME_AI_MODEL`: a model ID supported by that account and the provider's structured-output endpoint. There is deliberately no silently selected, potentially paid model.
- `RESUME_AI_DATA_POLICY=approved`: an administrator's confirmation that the chosen account's terms and data handling permit processing users' personal resume facts. **This flag does not change the provider's data practices.** Leave it unset until the actual provider/account setup has been checked. Google's unpaid-service terms prohibit submitting personal or confidential information; removing contact headers alone does not make work history anonymous. No billing account is created or upgraded by this integration.
- Optional `RESUME_AI_DAILY_LIMIT`: per-user daily attempts, default 10, clamped to 1–50. A separate fixed global cap permits at most 50 attempted model requests per UTC day.

Provider documentation: [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini data terms](https://ai.google.dev/gemini-api/terms), [Grok structured output](https://docs.x.ai/developers/model-capabilities/text/structured-outputs). Free chat access does not establish free API access. No provider is enabled merely by deploying this code, and no failover to another paid provider occurs.

## Workflow and safeguards

Click Generate resume on a job, select factual or AI-assisted wording, and prepare a preview. AI mode requires an explicit checkbox naming the selected provider. Only bounded editable facts with stable IDs and a limited job description are submitted. Direct identity/contact headers and facts containing those values are excluded. Known email addresses and URLs are removed from the JD. This reduces disclosure but is not a guarantee of anonymization.

The JSON schema limits output to existing fact IDs and plain text. Application checks reject changed/new numeric tokens, newly attributed recognized technologies, selected unsupported claims, unknown proper nouns, duplicate IDs, unexpected properties, excessive text, contacts and multiline markup. All rewrites are validated together; a rejected response becomes a factual draft. These checks cannot prove semantic accuracy. The UI shows before/after text, and AI drafts require the user to attest that they reviewed the wording before final generation.

The existing renderer supplies an authenticated PDF layout preview. Final approval binds the immutable draft to the same user, job revision and verified-profile revision. The background renderer revalidates the rewrites against the current baseline, uses the same template, and records provider/model/writer provenance. AI output does not claim zero fabricated facts: that field is `null`, with an explicit validation limitation. Factual generation retains its previous behavior and API compatibility.

Page reads and source syncing never invoke AI. Successful previews cache for 24 hours by user/profile/job/model/template/writer version. A persistent task lease prevents normal concurrent duplicate requests. Transient or rejected AI responses cache a factual fallback for two minutes. Each preview record has a unique immutable ID and a 24-hour validity period; a later retry cannot silently replace text in an already-open preview. Profile/job changes invalidate approval. Preview expiry is an access/approval limit, not a promise that storage objects are automatically deleted.

Migration `0008_resume_ai_usage.sql` creates the small indexed usage-counter table. The AI request path can create it lazily for an existing deployment, so it does not depend on manually applying a migration while D1 is unavailable. Keys and provider payloads are never logged or returned to clients. Mocked provider tests cover JSON contracts, redaction, unsupported claims, quotas, cache reuse, review enforcement, PDF/DOCX generation, stale revisions and cross-account preview isolation.

## Current operational limitation

Profile facts and final resume metadata still live in D1. The public-job MongoDB fallback cannot supply a verified personal profile. AI status can be read without D1, but preparing/finalizing a resume still needs the profile database to be available. A missing provider key/model or unconfirmed data policy leaves AI writing disabled; factual previews remain available when profile access works. This release was tested with mocked provider responses, not a live Gemini/Grok key.
