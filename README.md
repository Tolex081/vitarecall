# VitaRecall

A patient and clinician demo with quick X/Twitter-handle profiles, care notes, chat history, and an explicit Walrus Memory save-and-recall workflow. The frontend uses React/Vite; the API uses Express and SQLite through Node's built-in `node:sqlite`. Gemini supplies chat responses. Original generated artwork lives in `src/assets/`.

This is a working hackathon implementation for **synthetic patient data**. Live Gemini responses and mainnet Walrus writes require your own provider credentials and end-to-end verification. Configuring the code does not itself create a blob or prove hackathon eligibility.

## Testing and split deployment

Start with the [five fictional patient scripts](docs/patient-testing/README.md) for structured multi-day memory tests. The [deployment guide](docs/DEPLOYMENT.md) explains the selected architecture: Vercel serves the frontend and proxies `/api` to a separate persistent Node backend. Do not import this repository into Vercel expecting local SQLite to become a durable hosted database. The dedicated `build:vercel` requires `VITA_API_ORIGIN`; provider keys stay on the backend.

## Local setup

Use Node **22.17 or newer** and npm.

```sh
npm ci
```

Copy `.env.example` to `.env` in the project root, then fill in the server-side values below. In PowerShell:

If a `.env` file already exists, fill it in directly; do not overwrite an existing configuration.

```powershell
Copy-Item .env.example .env
```

```sh
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the API at port `3001`. Keep `APP_ORIGIN=http://localhost:5173` and `COOKIE_SECURE=false` for local HTTP development. If PowerShell blocks npm's script, use `npm.cmd` in place of `npm`.

Accounts, notes, and care tasks can be used without external provider keys. Chat and memory operations report missing configuration or provider failures; they do not substitute simulated AI answers or fake blob receipts.

## Configure providers

Create your own mainnet account and delegate key at [Walrus Memory](https://memory.walrus.xyz). Put the Ed25519 delegate key in `MEMWAL_KEY`, the account ID in `MEMWAL_ACCOUNT_ID`, and retain `MEMWAL_URL=https://relayer.memory.walrus.xyz`. Use a dedicated Sessions wallet/account and complete any account funding or capacity steps required by the service. The hosted relayer handles the storage workflow. See the [official MemWal quick start](https://github.com/MystenLabs/MemWal/blob/dev/docs/sdk/quick-start.md).

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/api-keys), put it in `GEMINI_API_KEY`, and select an available model with `GEMINI_MODEL` (default: `gemini-3.1-flash-lite`). Account quota and billing apply. This model was verified with live Walrus recall after Gemini 3.8 Flash returned overload errors during development. See [Google's API-key instructions](https://ai.google.dev/gemini-api/docs/api-key).

The Walrus account ID, Walrus delegate key, and Gemini API key are **different values**. Connecting Walrus does not connect Gemini. If the app says **Gemini is not connected yet**, open the existing root `.env`, set `GEMINI_API_KEY` to the actual key from AI Studio, save the file, and restart the API process (or stop and rerun `npm run dev`). Then refresh the browser. A project ID or model name will not work as an API key. Never paste the key into the chat box. `.env` changes may not trigger the development server's source-file watcher.

The default demo flow needs no clinician invite. `CLINICIAN_INVITE_CODE` is only for the legacy email/password clinician registration flow; set it to a long, random private value if using that flow. Keep all provider credentials and this invite in server environment variables or your host's secret store. Do not paste private keys into chat, commit `.env`, or prefix secrets with `VITE_`: Vite variables may be exposed to the browser.

## Use the app

1. Choose **Try the demo**, enter an X/Twitter username, select the patient or clinician view, and choose **Start chatting with Vita**. No email, password, or clinician invite is needed for this demo flow. A new patient starts with an empty workspace. Existing email/password accounts remain available under **Email account**.
2. Keep the private recovery code shown once when creating the demo profile. Use **Restore demo** with the same username and code on a new browser or device. A public username alone does not unlock an existing workspace: creating another profile with that handle creates a separate workspace. Treat the recovery code like a password; do not include it in screenshots, articles, or repository files.
3. Open **Chat with Vita**. Vita uses the walrus doctor artwork, asks what to call you and what you need help with, and responds with supportive follow-up questions. It is an AI health-information assistant, **not a doctor**. The clinician view is a demo role, not evidence of professional credentials. A patient must share their care code before a clinician profile can link that patient's workspace.
4. Enable the patient's memory consent before saving a memory. Consent starts off. In **Patient memory**, choose **Review a new memory**, inspect the exact content, then choose **Save reviewed memory**. A submitted background job becomes a confirmed memory only after the relayer returns a blob receipt. Chatting alone does not store a new Walrus memory.
5. Choose **New conversation** after saving a useful fictional preference. Previous chat turns are excluded from the new conversation's visible transcript and model context, while Walrus recall remains active. This does not delete the older database records. Ask a relevant question and inspect the returned source badges and full blob ID. This distinguishes actual memory recall from simply replaying local chat history.
6. Restore the same profile on another device with its recovery code and repeat the question to demonstrate continuity. Patient and clinician chat histories remain separate; linked care notes and memories use the patient's shared care workspace.

X handles are **unverified display names**, not X OAuth sign-in. [Unavatar](https://unavatar.io/docs) retrieves the handle's existing public profile image; it does not authenticate the user or generate a new portrait. The app supplies an initials fallback if the image cannot load. Avatar requests disclose the handle and browser connection information to Unavatar. Retain the public Unavatar attribution link when deploying on its free tier.

Turning consent off stops future memory saves. It does **not** erase already stored records or blobs. A Walrus `blobId` identifies stored content; it is **not** a Sui transaction hash. The app should only display a transaction digest if a provider actually returns one. See the [MemWal API reference](https://github.com/MystenLabs/MemWal/blob/dev/docs/sdk/api-reference.md) for job and receipt semantics.

## Verify

```sh
npm test
npm run test:e2e
npm run build
```

Automated checks can exercise application behavior with test providers. They do not prove that your real API keys, account funding, model access, or mainnet writes work. Verify those with a synthetic patient after configuration.

The browser checks use an installed Google Chrome (`channel: "chrome"`) and a separate temporary database. If Chrome is unavailable, install Chrome or change the Playwright channel to an installed browser. No external provider calls are made by these checks.

## Deploy

Use a host that runs a persistent Node process or container. Build and start with:

```sh
npm ci
npm run build
npm start
```

The API serves the built frontend and `/api` on `PORT` (default `3001`). Set `NODE_ENV=production`, `APP_ORIGIN` to the exact public HTTPS origin, such as `https://your-app.example`, and `COOKIE_SECURE=true`. Supply the remaining secrets through the host. This repository does not deploy automatically.

SQLite lives under `DATA_DIR` (default `./data`). Mount persistent storage there, run **one Node instance**, and back up the database. An ephemeral filesystem loses accounts, sessions, notes, and receipts when replaced. This deployment is unsuitable for Vercel-style ephemeral serverless functions as configured; it needs a persistent server and volume, or a future database/session redesign.

The included Dockerfile builds the frontend and runs the API as a non-root user. For a local container smoke test:

```sh
docker build -t vitarecall .
docker volume create vitarecall-data
docker run --rm --name vitarecall -p 3001:3001 --env-file .env -e NODE_ENV=development -e APP_ORIGIN=http://localhost:3001 -e COOKIE_SECURE=false -v vitarecall-data:/app/data vitarecall
```

The local command overrides `NODE_ENV` only to allow an HTTP smoke test. For a public deployment, retain the image's `NODE_ENV=production`, configure HTTPS, and set the production origin/cookie values. The image excludes `.env`, local data, and test artifacts; pass secrets at runtime. Ensure any bind-mounted data directory is writable by the container's `node` user.

## Hackathon evidence still required

### Reproducible mainnet verification

After configuring your own account, `node scripts/verify-mainnet.mjs check` performs a signed, read-only credential check. Account IDs copied as 64 hex characters without `0x` are normalized automatically.

The evidence has separate meanings:

| Evidence | What it proves |
| --- | --- |
| Signed connection check succeeds | These server credentials can access the configured mainnet account. It does not prove a write occurred. |
| Completed job with a full `blobId` | The submitted memory has a storage receipt. A pending job ID alone is not a blob receipt. |
| Fresh-client recall returns that blob and original text | Walrus Memory can retrieve the saved context without relying on local chat history. |
| Public mainnet download succeeds | The encrypted blob bytes are retrievable from the mainnet aggregator. It is not a readable medical record or a Sui transaction digest. |

`node scripts/verify-mainnet.mjs write` **submits one fictional memory to mainnet** through the same patient-consent and memory API used by the app. It creates a separate fictional demo patient and preserves the request ID to prevent duplicate submissions when rerun. It can incur provider storage costs. Run this only when you intend to make that live write.

Then run the following in separate processes:

```sh
node scripts/verify-mainnet.mjs status
node scripts/verify-mainnet.mjs recall
node scripts/verify-mainnet.mjs download
```

The status command checks the existing job. Repeat it later if still processing. The recall command matches the complete blob ID and exact original text from a fresh client. The download command retrieves encrypted bytes from the public mainnet aggregator with a strict consistency check and records their SHA-256. Neither recall nor download submits another memory.

Evidence is written to `DATA_DIR/mainnet-proof.json`; credentials for the fictional app profile are stored separately in `DATA_DIR/mainnet-demo-login.json`. Both remain in the ignored data directory. **Never publish the login file.** The optional `node scripts/capture-mainnet-proof.mjs` signs into that profile, checks the live connection, recalls the existing memory, and saves a screenshot to `DATA_DIR/mainnet-proof.png`. Keep the evidence JSON and database together so the verifier can resume safely.

With the local server running and Gemini configured, `node scripts/verify-chat.mjs` signs into that existing fictional profile and starts a fresh conversation. It verifies that the live model receives the existing Walrus blob with no previous chat history. It makes one billable model request and stores a local chat exchange, but writes no new Walrus blob. The fictional response and memory trace are recorded in the ignored `DATA_DIR/chat-proof.json`.

One fictional memory was confirmed and recalled on mainnet during local development on September 29, 2026; the local evidence records that individual verification. This is not a claim of ten blobs, a complete account-wide count, a public deployment, or real-user adoption. A repository clone will not include the ignored evidence or demo login files. Do not manufacture dummy memories just to increase the count: collect useful, consented fictional-demo memories while testing the actual chatbot workflow.

### Submission requirements

The [official event rules](https://thewalrussessions.wal.app/chatbots/index.html) require a publicly reachable chatbot using Walrus Memory on mainnet, at least **10 blobs written by its agent**, the agent ID/blob count, a public source repository with setup instructions, the model used, and a dedicated Sessions wallet address. Publish the Medium or Inkray article with before/after behavior and real-use evidence; complete the required feedback, DeepSurge/form submission, and X-sharing steps. Keep genuine receipts and demonstrate use across sessions over several days. These publication and submission steps are manual; this app does not perform them automatically.

No count is claimed merely because this integration exists. Confirm each successful write and use the account's actual agent identifier and blob count; a MemWal account ID should not be assumed to be an agent ID.

## Current limits

This is not ready to handle real medical records or provide clinical decisions. The hosted MemWal relayer processes plaintext before encryption, and recalled context is sent to the chat model. Use synthetic data until the providers, access controls, consent, retention, and healthcare obligations have been reviewed for the intended deployment.

Demo authentication uses a persistent browser session and a private recovery code, not verified X identity. Legacy email/password accounts remain supported with an invite for legacy clinician registration. Clinician demo profiles are not verified medical professionals. Email verification, legacy password recovery, MFA, full audit/retention controls, and production healthcare compliance are not implemented. Care content and AI replies need human review. Keep the database, recovery codes, and server secrets private, and do not treat a patient-reported statement or an unverified demo role as clinical confirmation.
