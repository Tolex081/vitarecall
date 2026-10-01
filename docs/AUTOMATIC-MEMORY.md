# Automatic conversation memory

Vita can archive complete exchanges (the user's message and the AI reply), not just a generated summary. This is an explicitly opted-in fictional-data pilot, not a clinical-record system.

## Try it

1. Restore the same demo profile with its username and private recovery code.
2. On desktop, use the automatic-memory panel beside Chat with Vita. On phones, tap **Walrus memory** above the conversation (or the **Memory** tab). Read the disclosure and select **Enable automatic memory**.
3. Share a fictional name, a concern, and a useful preference. Ask a practical question.
4. Wait for confirmed chat parts. In **Patient memory**, expand **Chat archive receipts** to see the actual job and full mainnet blob IDs. A queued or processing part is not proof of storage.
5. Select **New conversation**. Ask what Vita remembers without repeating the detail. Inspect the reply's Walrus source IDs and **No previous chat history sent** trace.
6. Restore this profile in another browser and repeat. A new demo username creates an isolated profile; it cannot recover this memory.

For older chats, including cleared ones, explicitly select **Also save earlier chats** in Patient memory. This queues up to ten previously unarchived completed exchanges per click. Repeat if the notice says more remain. No prior transcript is uploaded solely because the app was upgraded or because manual-save consent was enabled.

## What clearing and pausing do

- **New conversation** hides earlier messages and excludes the old local transcript from the model's conversation history. It does not delete SQL records, the archive queue, or Walrus blobs. Relevant saved text may still be retrieved from Walrus and sent to Gemini.
- **Pause automatic memory** stops future archiving and cancels unsent queued parts. It cannot cancel a submission already in flight, and it does not delete existing stored memory. Previously cancelled parts are not silently requeued when re-enabled.
- Recovery credentials, API keys, and session tokens are never included in the archive.
- Private conversation archives are scoped to both patient and user. They are separate from reviewed memories shared within a care workspace. Linking a clinician does not grant access to a patient's private transcript archive.

## Delivery and honest limitations

The completed chat exchange and archive outbox are committed in the same database transaction. Long exchanges are split into bounded JSON envelopes without losing text; all parts need receipts to consider the entire exchange stored. AI replies are explicitly marked as AI-generated, not verified clinical facts.

While the browser is open, bounded authenticated sync requests submit queued parts and check receipts. Queued work survives reload/restart and resumes when that profile is reopened. There is no always-running background worker on the free deployment: closing the tab may leave unsent work until the next visit. Transient receipt failures remain pending. Use **Refresh chat memory** if automatic polling stops.

The relayer does not supply our application with a write-idempotency key. Before submitting, a database claim prevents duplicate uploads from simultaneous requests. An ambiguous timeout/crash stays **Submission unconfirmed** and is not blindly resubmitted: the operator must reconcile it with the Walrus account. A failed or unconfirmed part is not counted as stored. Never describe this as guaranteed delivery or permanent storage.

Recall retrieves selected relevant excerpts (currently up to six from each authorized namespace), not every word of every chat on every turn. A receipt proves storage, while matching source IDs prove recall; indexing and retrieval availability are separate. Vita is instructed not to invent missing memories or treat archived AI advice as clinical evidence.

## Deployment

Run `npm run db:migrate` before deploying this release. It applies the additive `002_conversation_memory` migration after the initial schema; runtime startup checks the marker but never migrates automatically. Existing consent and records are not overwritten. New tables remain server-only with RLS and no Supabase browser-role access.

Vita's prompt now answers substantive questions with explanations, examples, and safe next steps, using the same configured Gemini model with a larger answer budget and balanced thinking. Medical safety remains a model behavior that needs testing, not a clinical validation claim. Continue recording helpfulness, false memories, unsafe advice, and provider failures in the five-patient tests.

The [Walrus managed relayer documentation](https://docs.wal.app/walrus-memory/relayer/public-relayer) explains that it processes plaintext, covers storage fees through its server wallet, can apply usage limits, and has no SLA. Use fictional data only.
