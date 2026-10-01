# VitaRecall: submission preparation guide

Prepared October 1, 2026. This is a work plan and owner checklist, not confirmation that an entry has been submitted. The edge comes from making useful behavior easy to verify, not from promising perfection or hiding limitations.

## Start with one clear claim

**VitaRecall carries useful, fictional care preferences into a fresh conversation, with inspectable Walrus mainnet receipts.**

Lead with that claim. Show one strong example before explaining the stack. Avoid “AI doctor,” “remembers everything forever,” “fully decentralized,” “clinically validated,” or “end-to-end private.” Those claims are not supported by this build.

## Eligibility checkpoint

Confirm against the [official event rules](https://thewalrussessions.wal.app/chatbots/index.html) before submitting: reachable mainnet chatbot; at least ten agent-written blobs; verified agent ID/count; public source/setup; model/runtime; dedicated Sessions wallet; Medium/Inkray article with before/after and use evidence; feedback; Discord; DeepSurge plus required form; and the article shared under the announcement on X with @WalrusProtocol and #WalrusMemory. Check participant eligibility and submit only one entry.

Deadline: **October 9, 2026, 14:00 UTC / 15:00 Lagos**. Aim to finish October 8. The live rules and form take precedence over this checklist.

Official destinations: [DeepSurge event](https://www.deepsurge.xyz/hackathons/c0141a4a-21be-4009-bc63-7c168608c849), [submission form linked by the rules](https://airtable.com/appoDAKpC74UOqoDa/shro5iVzzjoWfZlPK), [Discord](https://discord.com/invite/walrusprotocol), [MemWal repository](https://github.com/MystenLabs/MemWal). The DeepSurge page could not be independently retrieved during preparation; verify its current fields yourself.

Gemini fits the alternative-model track; document runtime and actual integration friction. Article quality is separately recognized. Follow the official rules for any optional promotion or bug-bounty entry; do not assume an X post counts as third-party promotion.

## Readiness board

| Item | Current evidence | Remaining owner action |
| --- | --- | --- |
| Reachable app | https://vitarecall.vercel.app | Test anonymously on phone and desktop before submission |
| Public source | https://github.com/Tolex081/vitarecall | Pin the final deployed commit when completing the form |
| Public article and evidence | https://vitarecall.vercel.app/submission/index.html | Hosting this package is not Medium/Inkray publication or an event submission |
| Mainnet integration | Actual receipts and recall in this package | Recheck all linked receipts close to submission |
| Ten-blob floor | Earlier audit checked 11 distinct stored app blobs; two more useful exchanges are tested in this package | Verify current count and ownership against the correct **agent ID**; do not substitute app totals for agent proof |
| Model/runtime | Gemini `gemini-3.1-flash-lite`; Node.js 24 on Vercel | Confirm deployed configuration and model availability |
| Before/after | Controlled operator-run synthetic experiment | Record short video; keep failures and experimental controls visible |
| Independent use | Five role-play scripts exist; completed volunteer evidence not verified | Recruit five adults, collect real return visits and permission |
| Article | Medium-ready draft and assets in this folder | Add verified field-use findings, review voice/byline, publish |
| Feedback | Friction/improvement template below | Verify the observation, complete the actual feedback form |
| Wallet / agent identity | Not verified in this package | Supply only public IDs/addresses; never private keys or seed phrases |
| Submission / sharing | No completion claimed | Register, submit required fields, publish X reply, save acknowledgments |

### Agent ID is a separate check

Do not copy `MEMWAL_ACCOUNT_ID` into the agent field merely because both look like IDs. Confirm what the event means by agent identity in the MemWal account/dashboard or with organizers. Record the account-to-agent relationship and obtain a dated screenshot or export showing the relevant mainnet count. A relayer job ID, a blob ID and a Sui transaction digest identify different things. Label each accurately. No transaction digest has been independently established by this package.

Use a dedicated Sessions-compatible wallet. Verify its address inside the wallet; copy only the public address into the form. Do not share recovery phrases, delegate secrets, service keys or wallet exports with anyone.

## The judge's first two minutes

Prepare one public evidence URL as the entry point. Order it this way:

1. One-sentence promise, live demo and repository.
2. A 90-second before/after video with readable source IDs.
3. The exact prompt, genuine replies and concise observed outcome.
4. One-click mainnet receipt and downloadable sanitized evidence.
5. Architecture, reproduction instructions and honest limitations.
6. Actual volunteer return-visit findings with dates and denominators.

The generated walrus images establish character. They must never stand in for proof. Label illustration, actual app screenshot, transcript extract and diagram distinctly.

## Independent testing: October 2–6

Send each volunteer one file from [the five-person test pack](https://github.com/Tolex081/vitarecall/blob/main/docs/patient-testing/README.md). A volunteer portrays a fictional scenario; they need not have the condition. No real health information or personal prescriptions should be entered.

Arrange three short visits across different dates, ideally October 2, 4 and 6. Use actual dates if the plan changes. Each tester keeps their own private recovery code. On the return visit they restore the original profile, start a new conversation, and ask without restating the saved facts. Include a correction, an unrelated question, and a no-invention check. Run scripted safety checks only as synthetic exercises; nobody should follow medication advice produced during a test.

Keep these outcomes separate:

| Measure | How to record it |
| --- | --- |
| People | Unique consenting volunteers, excluding operator/probe accounts |
| Return use | People with completed visits on different calendar dates; record timezone |
| Storage | Confirmed distinct blob IDs / attempted intended exchanges; note multi-part exchanges |
| Retrieval | Return questions with the intended source ID / eligible return questions |
| Useful behavior | Replies honoring the preference / replies tested, with short examples |
| Correction | Later replies honoring the newer preference / correction trials |
| Isolation / no invention | Pass, fail or not tested, including the actual prompt and evidence |
| Friction | Median observed wait if measured; counts of unknown, failed or pending operations |
| Safety | Observed boundary failures and delays, not a clinical safety score |

Use counts such as “4 of 5 completed a return visit,” not a percentage without the denominator. Five volunteers are a small qualitative pilot, not statistical evidence. Account registrations, requests, blobs and people are different quantities.

Suggested permission request: “Would you volunteer to test a fictional role-play scenario? You may stop at any time. Do not enter real health information. May I publish anonymized excerpts and your feedback in a public hackathon article? You can agree to testing while declining publication.” Record their actual answer privately. Do not promise that already published screenshots or Walrus content can be fully deleted.

## October 7–8: package the findings

- Choose the clearest successful return and one meaningful limitation. Do not cherry-pick only favorable trials or hide failed corrections.
- Summarize the number invited, completed visits, dates, and untested checks. Keep the full private scorecards.
- Ask permission for any quotation. Quote the actual words; never write an ideal testimonial and attribute it to a tester.
- Add a short field-use section to the article. The current controlled experiment remains separate.
- Capture a readable mobile screenshot and a desktop receipt. Exclude handles if a tester has not consented to publication.
- Pin one code commit and give exact setup commands. Test a fresh clone using your own credentials, not a published shared account.
- Verify links with a logged-out browser. The demo, article, video and evidence must not require your personal login to view.

## Paste-ready form copy

### Short description

VitaRecall is a Gemini-powered care-information companion exploring continuity between conversations. In a fictional-data demo, it archives completed exchanges through Walrus Memory on mainnet, recalls relevant context in a fresh chat, and exposes source receipts so the difference can be inspected. It supports appointment preparation and communication preferences; it does not diagnose, prescribe, or replace a clinician.

### Technical description

React/Vite frontend and Express API on Vercel; Supabase PostgreSQL for profiles, sessions, visible chat state and durable archive jobs; Gemini `gemini-3.1-flash-lite` for replies; MemWal SDK `0.1.8` with the hosted mainnet relayer for memory writes and retrieval. The server scopes memory by profile, records asynchronous job status, accepts storage only after a confirmed blob receipt, and supplies retrieved context separately from current chat history. Credentials remain server-side. “New conversation” resets the visible history boundary, not the stored Walrus archive. Storage and recall are distinct operations; failures are shown explicitly.

### What is different

The demo tests behavioral continuity rather than a decorative memory badge: an identical neutral question is asked before saving, after confirmed saving in a fresh session, and after a corrected preference. The public evidence pairs each actual response with the no-history trace and matching mainnet sources. A friendly mobile interface makes the chat and memory status accessible, while the pilot deliberately limits input to synthetic data.

### Model/runtime entry

Google Gemini, `gemini-3.1-flash-lite`, called server-side from Node.js 24 / Express on Vercel. MemWal SDK `0.1.8`. Supabase PostgreSQL. Verify these versions against the final deployed commit before pasting.

### Honest integration friction and improvement

**Candidate friction, not a claimed upstream bug:** saving returns a job identifier before confirmed storage is available. A serverless request can finish before the full receipt workflow completes, so a chatbot must track pending state and resume receipt checks. VitaRecall uses database-backed jobs, bounded background processing and browser receipt polling. Unknown submissions are not blindly repeated.

**Improvement proposal:** a documented serverless reference workflow with idempotent write identifiers, durable receipt reconciliation, and clear delivery/retention semantics would make integration easier. An authenticated completion callback would be useful if supported safely. Verify current SDK/documentation support before suggesting it as missing; frame this as a workflow improvement, not a proven service defect.

If filing a real issue, first reproduce it independently of VitaRecall. Include minimal steps, expected/actual behavior, timestamp, network, model, runtime, OS and SDK version; attach sanitized logs. Do not file our UI bug as a MemWal bug or claim a timeout proves a duplicate write. Do not include private prompts, account secrets or recovery files.

## Medium publishing checklist

Open `article.html` for the formatted preview and `ARTICLE.md` for editable text. Upload the images from `assets/` into Medium; local file references will not transfer automatically. Keep the cover and the correction illustration, then use genuine response/receipt screenshots and the architecture diagram. Add each supplied caption and descriptive alt text.

Review the first-person voice as your own account of the build. Replace no facts with better-sounding invented results. Add an honest AI-assistance acknowledgment if appropriate to your publishing context. Choose a clear byline, subtitle and preview image. Suggested topics: Artificial Intelligence, Web3, Software Development, Chatbots, Developer Experience. Preview desktop and mobile, check links and figure legibility, and only then publish. Publication has not been performed by this package.

### X reply draft — publish only after the article is live

“A new chat should not mean starting from zero. I built VitaRecall with Gemini + Walrus Memory and tested a preference across fresh conversations, including a correction. Real mainnet receipts, actual replies, and honest limits: [ARTICLE URL] @WalrusProtocol #WalrusMemory”

Post in the location specified by the event. Optional third-party promotion should be useful to that community, comply with its rules and disclose that you built the project. No spam or invented engagement metrics.

## Final owner handoff sheet

Fill these before submitting; blanks are deliberate, not hidden completion claims:

| Field | Owner value |
| --- | --- |
| Public name/byline and contact | TO COMPLETE |
| DeepSurge project URL | TO COMPLETE |
| Final deployed commit | TO COMPLETE |
| Verified Walrus Memory agent ID | TO COMPLETE |
| Mainnet count, evidence URL and verification time | TO COMPLETE |
| Dedicated Sessions wallet public address | TO COMPLETE |
| Medium/Inkray article URL | TO COMPLETE |
| Public evidence URL | https://vitarecall.vercel.app/submission/evidence.html |
| Public video URL, if recorded | NOT RECORDED; the demo plan is not a finished video |
| Volunteer use summary with actual dates | TO COMPLETE |
| Feedback confirmation / valid issue link if any | TO COMPLETE |
| Discord participation confirmation | TO COMPLETE |
| X reply URL | TO COMPLETE |
| Submission confirmation and timestamp | TO COMPLETE |

On October 8, submit once, preserve the confirmation and take a sanitized screenshot. On October 9, leave time for link failures and inspect the final public entry. A detailed submission improves verifiability; it cannot guarantee a prize.
