# Automatic conversation memory

Vita automatically archives complete new exchanges (both the user message and the AI reply). For new patient and fictional-demo profiles, automatic memory is **on by default**. There is no per-message save button. It can be paused later in the workspace; this remains a fictional-data pilot, not a clinical-record system.

Existing profiles keep their current setting. Login, restore, a new conversation, and an app update never turn an explicit off choice back on. Legacy profiles with no automatic-memory setting also remain off; reviewed-note consent is not treated as permission to upload whole transcripts. This release changes new-profile initialization, not historical records, and needs no database migration.

## Try it

1. Sign in with the same verified Telegram account or email account on the device you are using. The one-click fictional demo is intentionally disposable and cannot be restored.
2. New profiles already have automatic memory on. On desktop, inspect the panel beside Chat with Vita; on phones, tap **Walrus memory** or **Memory**. You can pause/resume here or in **Settings**. If opening an older or opted-out profile, its previous setting is preserved.
3. Share a fictional name, a concern, and a useful preference. Ask a practical question.
4. Wait for confirmed chat parts. In **Patient memory**, expand **Chat archive receipts** to see the actual job and full mainnet blob IDs. **View blob on Walrus Scan** opens `https://walruscan.com/mainnet/blob/<full-blob-id>`. Recalled sources link to the same explorer. A queued or processing part is not proof of storage; explorer indexing may lag, and the encrypted blob is not a readable chat transcript.
5. Select **New conversation**. Ask what Vita remembers without repeating the detail. Inspect the reply's Walrus source IDs and **No previous chat history sent** trace.
6. Sign in to this profile in another browser with the same Telegram or email account and repeat.

For older chats, including cleared ones, explicitly select **Also save earlier chats** in Patient memory. This queues up to ten previously unarchived completed exchanges per click. Repeat if the notice says more remain. No prior transcript is uploaded solely because the app was upgraded or because manual-save consent was enabled.

## What clearing and pausing do

- **New conversation** hides earlier messages and excludes the old local transcript from the model's conversation history. It does not delete SQL records, the archive queue, or Walrus blobs. Relevant saved text may still be retrieved from Walrus and sent to Gemini.
- **Pause automatic memory** stops future archiving and cancels unsent queued parts. It cannot cancel a submission already in flight, and it does not delete existing stored memory. Previously cancelled parts are not silently requeued when re-enabled.
- Passwords, API keys, session tokens, and Telegram login proofs are never included in the archive.
- Private conversation archives are scoped to both patient and user. They are separate from reviewed memories shared within a care workspace. Linking a clinician does not grant access to a patient's private transcript archive.

## Delivery and honest limitations

The completed chat exchange and archive outbox are committed in the same database transaction. Long exchanges are split into bounded JSON envelopes without losing text; all parts need receipts to consider the entire exchange stored. AI replies are explicitly marked as AI-generated, not verified clinical facts.

After a completed chat or explicit earlier-chat backfill, the server starts a bounded sync attempt without waiting for the browser to request a save. On Vercel, `waitUntil` keeps this work attached to the invocation after the response; it is not a separate durable worker. A deadline guard leaves work queued if fewer than 75 seconds remain. See the [Vercel background-task limits](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil).

While the browser is open, authenticated sync requests automatically finish queued parts and check receipts. After twenty checks the interval slows from six to thirty seconds instead of requiring a manual refresh. Queued work survives reload/restart and resumes when the same profile is reopened. Closing the app can still leave work unfinished: the free deployment has no always-running worker, and platform timeouts or provider failures can interrupt delivery. The optional **Refresh chat memory** control checks status; it is not a save-per-message step.

The relayer does not supply our application with a write-idempotency key. Before submitting, a database claim prevents duplicate uploads from simultaneous requests. An ambiguous timeout/crash stays **Submission unconfirmed** and is not blindly resubmitted: the operator must reconcile it with the Walrus account. A failed or unconfirmed part is not counted as stored. Never describe this as guaranteed delivery or permanent storage.

Recall retrieves selected relevant excerpts (currently up to six from each authorized namespace), not every word of every chat on every turn. A receipt proves storage, while matching source IDs prove recall; indexing and retrieval availability are separate. Vita is instructed not to invent missing memories or treat archived AI advice as clinical evidence.

## Deployment

Run `npm run db:migrate` before deploying this release. It applies the additive `002_conversation_memory` migration after the initial schema; runtime startup checks the marker but never migrates automatically. Existing consent and records are not overwritten. New tables remain server-only with RLS and no Supabase browser-role access.

Vita's prompt now answers substantive questions with explanations, examples, and safe next steps, using the same configured Gemini model with a larger answer budget and balanced thinking. Medical safety remains a model behavior that needs testing, not a clinical validation claim. Continue recording helpfulness, false memories, unsafe advice, and provider failures in the five-patient tests.

The [Walrus managed relayer documentation](https://docs.wal.app/walrus-memory/relayer/public-relayer) explains that it processes plaintext, covers storage fees through its server wallet, can apply usage limits, and has no SLA. Use fictional data only.
