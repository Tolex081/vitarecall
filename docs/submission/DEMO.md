# The demo: make the memory observable

This is a controlled fictional demonstration, not a patient testimonial. Use a new isolated profile. Do not reuse another person's workspace, publish credentials, or pretend a same-day session happened days later.

## The story in 90 seconds

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:10 | Live app and the care-companion label | “VitaRecall helps people prepare for care conversations. It is an AI companion, not a doctor. This demonstration uses only fictional preferences.” |
| 0:10–0:25 | Baseline question and answer; no saved sources | “An empty conversation should not invent a relationship. Here it explicitly has no saved preferences.” |
| 0:25–0:40 | Preference-bearing exchange, confirmed receipt, full blob link | “Mira asks for three short numbered items, ending with written questions. The completed exchange is archived through Walrus Memory on mainnet.” |
| 0:40–1:00 | Restore the SAME profile; new conversation; identical neutral question | “No previous chat history is sent. Watch the source ID and what changes in the answer.” |
| 1:00–1:15 | Genuine response and source matching the earlier receipt | “This is the difference between a storage badge and useful recall: the answer follows the saved preference.” |
| 1:15–1:30 | Correction result, evidence page, repository | “Preferences can change. Here is the observed correction result, with the limits documented. The transcripts, receipts and reproduction steps are available.” |

If the correction fails, say so and show the failure. Do not read this narration as a promise that every run passes. Adapt the final sentence to the actual evidence.

## Exact controlled sequence

Use this identical question for baseline, first return, and corrected return:

> Please help me prepare for an appointment using my saved preferences. What should I bring, and how should you format the answer? If you have no saved preferences, say so instead of guessing.

1. **Baseline:** new profile, automatic saving temporarily off, no saved memories. Ask the question. Expect no invented personal preferences, an empty memory trace, and `historyUsed: false`.
2. **Save:** enable automatic saving, start a new conversation, and send: “Fictional demonstration only, not medical care. Call me Mira. My appointment-preparation preference is exactly three short numbered items. The final item should remind me to bring my written questions. Please acknowledge these preferences briefly.” Wait for a stored receipt and full blob ID. Check it on Walrus Scan. Acknowledgment text by itself is not storage confirmation.
3. **Return:** pause new saves for experimental control; restore this profile in a fresh authenticated client; start a new conversation; ask the original question without repeating the preference. Check the exact source ID, the trace, and the answer separately.
4. **Correct:** enable saving, start a new conversation, and send: “Fictional demonstration only. I am correcting my earlier appointment-preparation preferences. Please replace the three-item numbered format with one short unnumbered paragraph. The last reminder should now be to arrange transport, not to bring written questions. My name is still Mira. Please acknowledge this update briefly.” Wait for confirmation.
5. **Return again:** pause saving, restore the same profile in another client, start a new conversation and repeat the original question. Record whether the newer preference wins. Save the real result even if it fails.

Pausing saves does **not** disable retrieval or erase previous blobs. This experiment archives only the two preference-bearing exchanges, avoiding extra copies of recalled answers. Ordinary new demo profiles default to automatic saving on.

## Reproducible capture script

Read [evidence.json](evidence.json) for the completed run. It contains exact synthetic prompts/replies and an allowlisted receipt record, not credentials. The screenshot response cards use an expanded chat scroll area for readability; their text and status are unchanged. Mobile screenshots retain the ordinary viewport. Generated illustrations are not screenshots.

`scripts/submission-demo.mjs` is an **explicit live** harness. It creates one isolated profile, makes five model calls and normally writes two small preference-bearing exchanges. Those calls can consume provider quota. It is not run by `npm test`.

On a clean clone, use your own configured deployment and a locally installed Playwright browser. Set `DEMO_ORIGIN` to that deployment. If the checked-in `evidence.json` exists but its private login does not, the script intentionally refuses to overwrite it. For an independent run, use a separate working copy and move the published evidence to a clearly named preserved copy first; never mix runs or overwrite another person's evidence.

Windows with installed Chrome:

```powershell
$env:DEMO_ORIGIN='https://YOUR-DEPLOYMENT.example'
$env:CHROME_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node scripts/submission-demo.mjs before
node scripts/submission-demo.mjs save
node scripts/submission-demo.mjs after
node scripts/submission-demo.mjs correct
node scripts/submission-demo.mjs updated
```

Run each stage separately. Credentials live only in ignored `data/submission-demo-private.json`. Preserve that private file to resume. A completed stage is reused without another model call. A pending stage retains its request ID; uncertain provider jobs need reconciliation, not duplicate writes. A screenshot failure does not erase a successful receipt.

## Record a three-minute walkthrough

Keep the 90-second sequence intact, then spend 45 seconds on the architecture and 45 seconds on limitations and real tester results. Record the live browser, not generated UI. Show the address bar at least once. Enlarge text before recording; hide unrelated tabs and notifications. Dismiss recovery-code banners. Do not display environment files, database consoles, account keys or tester names.

Storage may take longer than the video. You may cut waiting time, but label the cut “waiting for confirmation”; keep real timestamps and full receipt IDs in the evidence. Do not speed-cut a failed save into a successful one. Include captions in the video editor and verify them manually. Keep an uncut private original and a public, sanitized edit. Use a public no-login viewing link and test it in a private browser.

## What a skeptical judge should be able to check

- The before and after questions are identical and do not contain the answer.
- The source blob is the same one confirmed for the earlier exchange.
- The new conversation sends no previous chat history.
- The behavior follows the preference, not merely mentions that memory exists.
- The correction result is real; failures and untested items remain visible.
- No other user's context appears. A different profile must not inherit Mira's memory.
- Cross-day volunteer use is reported separately from this operator-run demonstration.
