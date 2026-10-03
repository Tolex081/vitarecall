# VitaRecall submission studio

Prepared October 1, 2026. Fictional data only. Medium publication, X posting and final submission remain owner actions.

## Open the package

- [Start here: visual package index](index.html)
- [Medium article preview](article.html) and [editable Markdown](ARTICLE.md)
- [Medium paste-in copy with no URLs](MEDIUM-ARTICLE.md) — upload the six matching images manually; the live plain-text copy is at [VitaRecall / Medium copy](https://vitarecall.vercel.app/submission/MEDIUM-ARTICLE.md)
- [Public-ready evidence page](evidence.html) and [exact sanitized data](evidence.json)
- [Submission preparation guide](SUBMISSION-GUIDE.md) / [formatted guide](guide.html)
- [90-second demo and reproduction plan](DEMO.md) / [formatted plan](demo.html)
- [Asset captions and publishing notes](ASSETS.md)
- [Image-generation prompts](ARTWORK-PROMPTS.json)

Public publishing destination: [VitaRecall submission studio](https://vitarecall.vercel.app/submission/index.html). The Vercel build copies only the explicit reviewed allowlist in `scripts/publish-submission.mjs`, never the private `data` folder. The article uses public evidence and reproduction links.

The HTML files also work as standalone previews: open `index.html` in a browser, keeping the `assets` folder beside it. GitHub normally displays HTML source rather than rendering it. Upload images directly in Medium; local image paths will not transfer automatically. Medium/Inkray publication and final submission are owner actions, separate from hosting this package.

## Verified in this run

The live app used the identical neutral prompt at three checkpoints. Before saving: no source and no claimed saved preference. After saving: Mira, three numbered items, and written questions last. After a correction: one paragraph, ending with arranging transport. The return traces show no prior chat history; their source IDs match the two confirmed mainnet blobs. Full prompts, replies and UTC timestamps are preserved, including the experimental control of pausing additional saves on read-back questions.

These are **observations from one same-day operator-run profile**, not a general accuracy guarantee. The five volunteer scripts are a plan, not completed field-use evidence. Agent identity, final blob-count attribution, wallet, article publication and submission confirmations still need owner verification.

## Rebuild previews without network calls

```powershell
$env:CHROME_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node scripts/build-submission.mjs
```

This formats local Markdown/evidence and renders the code-native architecture diagram; it does not call Gemini, write to Walrus, or publish anything. The separate `submission-demo.mjs` harness is an explicit live test described in [DEMO.md](DEMO.md).
