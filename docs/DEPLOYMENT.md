# Deploy the free VitaRecall pilot

The selected setup is **Vercel Hobby for the frontend and API, plus Supabase Free for PostgreSQL**. Walrus Memory remains the long-term memory engine; Gemini generates replies. This replaces the earlier separate paid/persistent-backend plan. There is no `VITA_API_ORIGIN` requirement now.

Use fictional patient information only. This is a hackathon support demo, not a medical service. These files prepare deployment; they do not create accounts, purchase services, migrate a remote database, or claim that a deployment has passed the checks below.

## 1. Create the free Supabase project

1. Open the [Supabase dashboard](https://supabase.com/dashboard), select your **Free** organization, and choose **New project**.
2. Name it `vitarecall`, generate a strong database password, and save that password in your password manager. Choose a region near the Vercel function region you intend to use. Do not buy an IPv4 add-on, upgrade the organization, or select a paid compute option for this pilot.
3. Wait until the database is ready. Open **Connect** and select **Transaction pooler**. Copy the entire PostgreSQL connection string; use the exact pooler host and username supplied by Supabase, with port `6543`.
4. Replace the password placeholder privately with the database password, percent-encoding reserved characters such as `@`, `#`, `?`, `/`, and `%`. This is a **database password**, not a Supabase publishable/anon API key. Never send the completed string in chat, a screenshot, or GitHub.
5. If certificate verification needs the project certificate, download the root certificate from **Database settings > SSL**. Save its PEM contents as `DATABASE_CA_CERT`; real newlines and literal `\n` sequences are accepted. TLS verification stays enabled; do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or use `rejectUnauthorized: false`.

The shared transaction pooler is appropriate for short-lived serverless connections and available over IPv4 without a paid add-on. The driver uses parameterized, unnamed queries rather than named prepared statements. [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)

### Database privacy

VitaRecall connects to PostgreSQL **only from the server**. Its tables live in the private `vitarecall` schema, not the public schema; do not add `vitarecall` to Supabase's exposed API schemas or grant browser roles access. The migration denies public/browser-role access. Keep the existing app's session, CSRF and patient-permission checks in place. Supabase Auth and the browser Data API are not used by this version, so no Supabase key belongs in the frontend. [Supabase data security](https://supabase.com/docs/guides/database/secure-data)

## 2. Apply the schema explicitly

Keep the existing local `.env` file and provider keys; do not overwrite it. Add `DATABASE_URL` privately. Then, from the repository root:

```sh
npm ci
npm run db:migrate
```

This command applies `001_initial.sql` and the additive `002_conversation_memory.sql` from `supabase/migrations`. Apply both before deploying the automatic-memory release. It is a real write to the configured database: double-check you selected the VitaRecall project before running it. These migrations are repeatable and do not overwrite existing patients or consent, seed fictional patients, or create Walrus blobs. Server startup and Vercel builds do not automatically run migrations.

For schema administration, Supabase recommends a direct connection or a session-pooler connection if your local network lacks IPv6. Use that connection privately as `DATABASE_URL` for the migration if needed, then set the **transaction-pooler** URL in Vercel for application traffic. Do not alter only the username or invent a pooler hostname. [Connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)

To test the PostgreSQL-backed app locally, keep `APP_ORIGIN=http://localhost:5173` and `COOKIE_SECURE=false`, set `DATABASE_URL`, then run `npm run dev`. Leaving `DATABASE_URL` empty continues to use the local SQLite database. Neither choice deletes or automatically copies the other database.

### Existing localhost profiles are not automatically imported

An empty Supabase project has no existing local accounts or receipts. A local Telegram or email account cannot reopen a workspace that was never created in the deployed database. For the five-tester pilot, create profiles on the deployed URL and return to that same deployment.

If preserving local profiles is required, use the optional explicit importer **before** creating profiles in Supabase. Stop the local API first, make a private consistent SQLite backup, and run `npm run db:migrate` against the intended Supabase project. With that PostgreSQL `DATABASE_URL` configured privately, run:

```sh
npm run db:import:sqlite -- --sqlite ./data/vitarecall.sqlite --confirm-empty-destination
```

The importer requires an empty destination and copies data in one PostgreSQL transaction. It preserves patient IDs and therefore Walrus namespaces, recovery hashes, care permissions, message order/cutoffs, and blob receipts. Keep the original Walrus account/delegate. Existing browser login sessions and temporary rate limits/locks are not copied; sign in or restore the profile again after import. Do not copy only blobs or create new patient IDs and expect old namespaces to follow. Never upload SQLite databases or private proof-login files to GitHub. Schema creation and data import remain separate, intentional operations.

## 3. Configure Vercel Hobby

Import the GitHub repository at its root into a **personal Hobby** project. Keep the checked-in settings: **Vite**, Node **22.x**, install `npm ci`, build `npm run build:vercel`, output `dist`. Enable **Fluid Compute**, which supports the configured 120-second function duration on Hobby; no paid plan is required for that configuration. [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration)

Use the stable production domain that Vercel assigns the project for `APP_ORIGIN`. Add the following variables privately in **Settings > Environment Variables**, scoped to **Production**, then redeploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Complete private Supabase shared transaction-pooler connection string |
| `DATABASE_CA_CERT` | Optional PEM root certificate, when needed for certificate trust |
| `APP_ORIGIN` | Exact stable public HTTPS origin, with no path, query, credentials, or fragment |
| `COOKIE_SECURE` | `true` |
| `GEMINI_API_KEY` | Your existing private Gemini key |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite`, or a model you have separately verified |
| `MEMWAL_ACCOUNT_ID` | Your own Walrus Memory mainnet account ID |
| `MEMWAL_KEY` | Your existing private delegate key |
| `MEMWAL_URL` | `https://relayer.memory.walrus.xyz` |

Vercel sets `VERCEL=1`; the app then enforces production HTTPS/cookies and refuses to start without `DATABASE_URL`. `DATA_DIR` is not used for the hosted database. The checked-in configuration sets `NODEJS_HELPERS=0` so Express owns request-body parsing and its 32 KB limit. Do not override this. [Node helper configuration](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration)

**All private values are server variables in this Vercel project.** Never prefix them with `VITE_`. The old advice to keep Gemini/Walrus keys on a separate backend applies only to the retired split deployment, not this setup. Do not upload `.env`; enter the individual values in Vercel settings. `CLINICIAN_INVITE_CODE` is optional and used only by the legacy email-account flow.

The frontend builds without contacting Supabase, Gemini, or Walrus. A successful build therefore does **not** verify provider credentials, migrations, or network access. A missing database/configuration problem returns a sanitized `503` API response instead of silently storing an ephemeral SQLite database.

### Routing and connection behavior

Vercel compiles `api/index.js` as a Node function. `vercel.json` sends `/api` and `/api/*` to it before static-file and SPA routing; Express receives the API request path. Vite assets are served from `dist`. No external backend host or cross-origin browser calls are needed. [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [routing configuration](https://vercel.com/docs/project-configuration/vercel-json)

Each warm function instance reuses its app and PostgreSQL pool. `attachDatabasePool` manages idle connections through the Vercel lifecycle. Sessions, request coordination and rate-limit state belong in PostgreSQL rather than a particular warm instance. There are no schema changes on normal requests. [Vercel pooling guide](https://vercel.com/kb/guide/connection-pooling-with-functions)

Do not deploy old `.vercel/output` artifacts from the former proxy build using `--prebuilt`. Use a fresh Git deployment and the current build configuration. Random preview URLs will not match production `APP_ORIGIN`; use a separate database and exact origin for preview testing, or share only the stable production URL. Do not weaken CSRF or cookie protections to make previews work.

## 4. Acceptance checks before inviting testers

These checks still need to run against the actual deployed project:

1. `/api/health` on the frontend domain must return JSON, not HTML, a redirect, or a 404. A green health endpoint is not a live Gemini/Walrus verification.
2. In a fresh browser profile, open the app and inspect `/api/session`. Its cookie must belong to the frontend host and have HttpOnly, Secure, SameSite Strict, and path `/`. Refresh and confirm the same session persists. Do not copy cookie values into reports. API responses must have `Cache-Control: no-store`.
3. In a fresh browser profile, choose **Continue with Telegram** or create an **Email account**. Confirm the authenticated POST goes to the same origin with the CSRF header. Confirm a POST with a wrong `Origin` or missing/incorrect CSRF token is rejected.
4. Send a harmless greeting for an actual Gemini response, and run the signed Walrus connection test in Settings. Configured badges alone do not prove live access.
5. With consent, save one useful fictional memory, wait for **stored** and its full blob ID, then choose **New conversation**. Ask about that detail without repeating it; inspect the retrieved source and confirm the trace says no old chat history was used. Check the existing receipt before retrying an ambiguous save timeout.
6. Sign in to the same profile in a different browser/device with the same Telegram account or email account. Start a new conversation and confirm recall. The one-click fictional demo is deliberately a new, disposable workspace each time.
7. Redeploy the Vercel app without changing the database or Walrus account. Confirm the existing session/profile, consent, receipts and recall survive. Also verify phone layout and concurrent duplicate-request behavior.
8. Record actual dates, receipts and failures with the [five fictional patient scripts](patient-testing/README.md). Do not call a pending job a blob or manufacture evidence.

## Free-tier limits and recovery

This can operate within free-tier allowances, not unlimited or guaranteed permanent free service. Vercel Hobby is for personal non-commercial use. Supabase Free has resource limits and may pause inactive projects. Watch dashboards, quotas and logs during the pilot; resume a paused project through Supabase before testing. Avoid upgrading or enabling billed services if the budget is zero. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Supabase pricing](https://supabase.com/pricing)

Gemini and Walrus have their own quotas and terms; hosting being free does not guarantee every provider request is free. Verify the selected Gemini project/tier and the managed Walrus relayer's current allowance before a testing session. A quota or provider outage must remain an honest error, not a fake response or receipt.

Keep private database backups and test restoration. The database maps app identities to patient IDs and Walrus namespaces: Walrus blobs alone cannot restore that mapping. Free hosting is not a backup or healthcare-compliance guarantee.

## Local and persistent-server alternatives

`npm run dev`, `npm run build`, and `npm start` retain their local roles. `npm run test:deployment` checks configuration without contacting providers. With no `DATABASE_URL`, local development uses SQLite at `DATA_DIR/vitarecall.sqlite`.

The existing Dockerfile/persistent Node option still works: build the frontend, run `npm start`, configure the exact HTTPS `APP_ORIGIN`, and keep secure cookies. If using SQLite, mount a persistent `DATA_DIR`, run one instance and back it up. Never put SQLite in a Vercel Function or `/tmp`. This alternative is not required for the selected free Vercel + Supabase pilot.
