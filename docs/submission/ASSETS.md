# Article assets and publishing notes

## Upload order

| File | Type | Caption / use |
| --- | --- | --- |
| `assets/walrus-cover.png` | Custom generated illustration | VitaRecall's companion carries context between conversations. AI-generated editorial illustration; not a screenshot or official endorsement. Use as Medium cover/preview. |
| `assets/after-answer.png` | Actual app response | After a confirmed save: three numbered items, written questions last, no previous chat history sent. Scroll area expanded for readable capture; text unchanged. |
| `assets/architecture.png` | Code-native implementation diagram | Browser → server; separate application database, Walrus Memory and Gemini roles. No claim that all app data is decentralized. |
| `assets/walrus-changing-preferences.png` | Custom generated illustration | Remembering well includes hearing a correction. Conceptual art, not evidence of automatic deletion. |
| `assets/updated-answer.png` | Actual app response | After the correction: one paragraph, transport last, two retrieved sources and no previous chat history sent. Reading-view capture; text unchanged. |
| `assets/correct-receipts.png` | Actual receipt panel | Two confirmed mainnet archive parts. Future saving was paused as an experimental control, not disabled by default for all users. |
| `assets/after-mobile.png` / `assets/updated-mobile.png` | Actual mobile viewport | Supplementary product screenshots at 390 CSS pixels wide; ordinary scrolling may show only part of a reply. |

The supplied Markdown image descriptions can be used as alt text. Keep captions on Medium. A small screenshot is not readable simply because it looks attractive; upload at native size and inspect the mobile preview. The early `before-answer.png` has scroll clipping and is not used in the article: use the exact baseline transcript instead. The early `save-answer.png` is supplementary; the complete two-receipt capture is the stronger storage figure.

## Provenance

The two editorial images were generated using the built-in image-generation tool. The existing VitaRecall mascot was used as a character reference, with a cardigan replacing clinical clothing in the new artwork. They do not reproduce an official Walrus logo and must not imply affiliation or endorsement. Full prompts are in [ARTWORK-PROMPTS.json](ARTWORK-PROMPTS.json).

The architecture graphic is a deterministic SVG rendered to PNG, not AI-generated. The application screenshots were captured from `https://vitarecall.vercel.app` using a dedicated synthetic profile. No answer text, receipt or status was edited. Desktop answer captures expand the chat's scroll container solely to avoid clipping; mobile captures use the ordinary viewport. The complete machine-readable transcript is in [evidence.json](evidence.json).

## Before publishing

1. Confirm every image opens, its caption is accurate, and text is legible on a phone.
2. Keep illustration and evidence labels explicit. Do not use an illustration as a thumbnail that claims to show a real patient.
3. Check for credentials, real names, browser notifications, recovery codes, unrelated account information, and user-specific data. Only the dedicated fictional profile is approved for this package.
4. The public evidence intentionally excludes the private login, patient/user IDs, cookies and keys. Never upload the ignored `data` folder or `.env`.
5. Add volunteer screenshots only with permission; create a new sanitized asset, never overwrite the factual controlled-demo record with a staged improvement.
6. Replace local article links with final public URLs after hosting. Do not post an inaccessible local path on Medium or X.
