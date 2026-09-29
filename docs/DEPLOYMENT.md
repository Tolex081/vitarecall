# Deploy VitaRecall for the five-tester pilot

Use **Vercel for the frontend** and **one persistent Node backend with a disk**. This repository does not provision hosting or purchase a plan. Use fictional patient information only: this is an AI-support demo, not a medical service.

## Why the backend stays separate

SQLite stores accounts, recovery-code hashes, sessions, consent, patient IDs, care permissions, chat history, and Walrus receipts. Patient IDs determine each patient's Walrus namespace. Mainnet blobs persist independently, but losing this database loses the app's identity-to-memory mapping. Walrus does not replace authentication or that mapping.

Do not run this SQLite backend on a Vercel Function or put the database in `/tmp`. Vercel documents that function instances do not share a durable local filesystem. [Vercel's SQLite guidance](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)

## 1. Persistent backend

Choose a Node/container host with HTTPS and a persistent disk or volume. Use the existing Dockerfile and **one instance**, not multiple independently writable database copies. No hosting account or paid plan is selected by these files.

For Docker, build the repository's Dockerfile, mount the persistent volume at `/app/data`, and expose the configured `PORT` (default `3001`) through HTTPS ingress. The image runs `npm start`. For non-Docker hosting, use Node 22.17+ with `node:sqlite`, `npm ci`, `npm run build`, and `npm start`.

Set these on the **backend only**:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | Exact stable HTTPS frontend origin assigned to the Vercel project, or your chosen custom domain; no path |
| `COOKIE_SECURE` | `true` |
| `DATA_DIR` | Persistent disk mount, `/app/data` for Docker |
| `PORT` | Port expected by the backend host; image default `3001` |
| `GEMINI_API_KEY` | Your private Gemini key |
| `GEMINI_MODEL` | Optional: use the model tested locally, or the code default |
| `MEMWAL_ACCOUNT_ID` | Your own Walrus Memory mainnet account ID |
| `MEMWAL_KEY` | Your private delegate key |
| `MEMWAL_URL` | `https://relayer.memory.walrus.xyz` |

Never put keys in GitHub, screenshots, frontend variables, or a `VITE_` variable. Do not upload the local `.env`; add values privately in the backend host's settings.

Confirm the backend's `/api/health` returns `{"status":"ok"}` over HTTPS. This does not verify Gemini or authenticated Walrus access; test those in the app.

### Local accounts versus deployed accounts

The deployed backend starts with an empty database unless you deliberately migrate one. A localhost recovery code cannot restore an account missing from the deployed database. Testers should create profiles on the deployed URL and return to that deployment.

To preserve local identities and receipts, migrate SQLite privately using a consistent SQLite backup, or stop the local server before copying the database. Do not copy only a live `.sqlite` file while its WAL has uncheckpointed changes. Keep the same Walrus account/delegate and preserve patient IDs. Never commit databases, recovery codes, or private proof login files. Back up the deployed database and test restoration. Deployment does not perform a migration automatically.

## 2. Vercel frontend

Import the GitHub repository at its root and use Node 22.x. The checked-in `vercel.json` selects **Other** as the framework preset, `npm ci` for installation, and `npm run build:vercel` for the build. Do not override the output directory to `dist`: this script emits Vercel Build Output API v3 under `.vercel/output`.

Add this environment variable to the Vercel project:

| Variable | Value |
| --- | --- |
| `VITA_API_ORIGIN` | Actual public HTTPS origin of the persistent backend; no `/api`, path, query, credentials, or fragment |

The backend address is configuration, not a secret. **Do not add Gemini or Walrus private keys to this frontend project.** Redeploy after changing `VITA_API_ORIGIN`.

The build fails deliberately when the origin is missing, uses HTTP, names localhost/an IP/documentation placeholder, or includes a path or credentials. A missing-origin build failure is a setup guard, not a Gemini error.

Only Vite's compiled frontend goes into `.vercel/output/static`. The generated routing configuration proxies `/api` and `/api/*` to the same paths on the backend before static-file routing. Other page paths fall back to `index.html`. No Express server or SQLite file runs on Vercel. [Build Output API](https://vercel.com/docs/build-output-api), [routing configuration](https://vercel.com/docs/build-output-api/configuration), [static output](https://vercel.com/docs/build-output-api/primitives)

External rewrites act as a reverse proxy: the browser stays on the frontend URL, while the backend must be reachable by Vercel. [Vercel rewrites](https://vercel.com/docs/routing/rewrites)

## 3. Connect the exact frontend origin

After the stable Vercel production domain or custom domain is known, set backend `APP_ORIGIN` to exactly that HTTPS origin and restart/redeploy the backend. Share only this URL with testers.

Do not point the browser directly at a cross-origin API. The app intentionally uses same-origin `/api` fetches, an HttpOnly `Secure; SameSite=Strict` cookie, and `X-CSRF-Token`. The rewrite keeps these on the frontend origin. Do not weaken cookies or remove CSRF checks to work around configuration errors.

Random preview URLs will not match production `APP_ORIGIN`. Use a separately configured backend/database for previews, or the stable production frontend for the pilot. Do not allow arbitrary origins. The backend currently trusts one reverse-proxy hop for client IP handling; verify the real hosting proxy chain before relying on IP rate limits, especially with Vercel's additional hop.

## 4. Acceptance checks before inviting testers

These are checks to run after deployment, not claims that a live deployment has passed:

1. At the frontend domain, `/api/health` must return JSON, not HTML, a redirect, or a 404.
2. In a fresh browser profile, inspect `/api/session` in developer tools. Its cookie must belong to the frontend host and have HttpOnly, Secure, SameSite Strict, and path `/`. Never copy the cookie value into a report. Refresh and confirm the session persists. Authenticated API responses must be `Cache-Control: no-store`.
3. Create a fictional profile. Verify its POST goes to the frontend origin with the CSRF header and succeeds through the proxy. Save the recovery code privately, not in screenshots.
4. Confirm a POST with incorrect `Origin` or missing/incorrect CSRF token is rejected. Do not disable those checks to resolve an auth error.
5. Send a harmless greeting for a real Gemini response; run the signed Walrus connection test in Settings. A configured badge or health endpoint alone does not prove live access.
6. With consent, save one intentional fictional memory, wait for **stored** and its full blob ID, then choose **New conversation** and ask about that detail without restating it. Check its retrieved memory source. Do not duplicate a save after an ambiguous timeout without checking its receipt.
7. Restore the same profile in another browser with its private recovery code; start a new conversation and check recall. Re-entering the same public X handle creates a different workspace and is not account recovery.
8. Restart/redeploy the backend without changing its persistent disk, then repeat login and recall. Record failures if accounts or receipts disappear. Also check a phone viewport.

Review provider usage and hosting logs during the pilot. Never cache authenticated API responses at either host. External rewrites have a platform timeout; the client timeout is 90 seconds, so inspect failed/unknown operations before retrying writes. [Vercel proxy limits](https://vercel.com/docs/limits)

## Local commands remain unchanged

`npm run dev` still starts the localhost frontend and API. `npm run build` still builds `dist`, and `npm start` still starts the persistent Node app. Run `npm run test:deployment` to check origin validation and routing without contacting a provider or writing a mainnet blob.
