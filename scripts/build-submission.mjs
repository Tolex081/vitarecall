// Local-only document renderer and evidence consistency checks. No live API calls.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { validatePublicEvidence } from './publish-submission.mjs';
import './build-medium-article.mjs';

const root = resolve('docs/submission');
const read = name => readFileSync(resolve(root, name), 'utf8');
const proof = JSON.parse(read('evidence.json'));
validatePublicEvidence(proof);
mkdirSync(resolve('data'), { recursive: true });
const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function inline(text) {
  const tokens = [];
  const hold = html => `\u0001${tokens.push(html) - 1}\u0002`;
  const url = value => {
    if (/^(?:javascript|data|file):/i.test(value)) throw new Error('Unsafe document link.');
    return esc(value);
  };
  text = text.replace(/`([^`]+)`/g, (_, value) => hold(`<code>${esc(value)}</code>`));
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, target) => hold(`<img src="${url(target)}" alt="${esc(alt)}" loading="lazy">`));
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, target) => hold(`<a href="${url(target)}">${esc(label)}</a>`));
  text = esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Links may contain earlier code tokens (blob IDs); resolve to a fixed point.
  for (let pass = 0; pass < 3; pass++) text = text.replace(/\u0001(\d+)\u0002/g, (_, id) => tokens[Number(id)]);
  return text;
}
function markdown(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    let line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('<!--')) { while (i < lines.length && !lines[i++].includes('-->')) {} continue; }
    if (line.startsWith('```')) {
      const code = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++; out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) { out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const row = lines[i++].split('|').slice(1, -1).map(cell => cell.trim());
        if (!row.every(cell => /^:?-+:?$/.test(cell))) rows.push(row);
      }
      out.push('<div class="table-wrap"><table>' + rows.map((row, n) => '<tr>' + row.map(cell => `<${n ? 'td' : 'th'}>${inline(cell)}</${n ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table></div>'); continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = []; while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`); continue;
    }
    if (/^(?:[-*] |\d+\. )/.test(line)) {
      const ordered = /^\d/.test(line), items = [];
      while (i < lines.length && (ordered ? /^\d+\. / : /^[-*] /).test(lines[i])) items.push(lines[i++].replace(/^(?:[-*] |\d+\. )/, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>` + items.map(item => `<li>${inline(item)}</li>`).join('') + `</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(?:#|>|\||```|[-*] |\d+\. )/.test(lines[i])) paragraph.push(lines[i++]);
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');
}
const css = `:root{color-scheme:light;--ink:#183e39;--muted:#657770;--green:#217c69;--line:#dbe6df}*{box-sizing:border-box}body{margin:0;background:#fbfcf8;color:var(--ink);font:17px/1.75 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#167663;text-underline-offset:4px;overflow-wrap:anywhere}nav{max-width:1120px;margin:auto;padding:22px 30px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:23px;flex-wrap:wrap;font-size:13px}nav b{margin-right:auto;font-size:18px}main{max-width:920px;margin:58px auto 90px;padding:0 30px}h1,h2,h3{line-height:1.18;letter-spacing:-.045em}h1{font-size:clamp(36px,5vw,57px);margin:10px 0 25px}h2{font-size:30px;margin:56px 0 20px}h3{font-size:22px;margin:35px 0 14px}.article>h1+h2{font-size:24px;line-height:1.5;color:var(--muted);font-weight:400;letter-spacing:-.025em;margin:0 0 33px}.eyebrow{text-transform:uppercase;letter-spacing:2px;color:var(--green);font-size:12px;font-weight:700}p{margin:20px 0}p:has(>em:only-child){font-size:13px;color:var(--muted);line-height:1.65;margin-top:10px}img{max-width:100%;height:auto;display:block;border-radius:14px}blockquote{margin:25px 0;border-left:3px solid var(--green);padding:12px 25px;background:#f0f6ee;color:#294e42;font-size:19px}pre{padding:24px;border-radius:14px;background:#122e2b;color:#e0f1e5;overflow:auto;font:13px/1.75 ui-monospace,monospace}code{font-family:ui-monospace,monospace;font-size:.82em;overflow-wrap:anywhere}li{margin:9px 0}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px;margin:25px 0}table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.6}th,td{padding:14px 17px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{background:#eef5ec}tr:last-child td{border-bottom:0}.note{background:#edf5e9;border:1px solid #d5e3cf;border-radius:14px;padding:18px 22px;font-size:14px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:28px 0}.card{padding:25px;background:white;border:1px solid var(--line);border-radius:18px}.card h2,.card h3{margin:5px 0 14px}.card p{font-size:14px}.stat{font-size:33px;font-weight:700}.meta{color:var(--muted);font-size:13px}.pill{display:inline-block;padding:3px 11px;background:#e9f3e5;border-radius:30px;font-size:12px;margin:3px}.step{margin-top:42px;padding-top:24px;border-top:1px solid var(--line)}details{margin:16px 0;border:1px solid var(--line);border-radius:12px;padding:15px 20px}summary{cursor:pointer;font-weight:600}.transcript{font-size:15px}.mobile-shot{max-width:340px;margin:25px auto}footer{margin:60px 0 0;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}.button{display:inline-block;background:#1c705d;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;margin:6px 12px 6px 0;font-size:14px}@media(max-width:600px){main{margin:32px auto;padding:0 20px}nav{padding:17px 20px;gap:15px}.cards{grid-template-columns:1fr}h2{font-size:26px}.card{padding:20px}body{font-size:16px}blockquote{font-size:17px;padding:12px 17px}}@media print{nav{display:none}main{max-width:none;margin:0;padding:0}details{break-inside:avoid}img{max-height:700px;object-fit:contain}a{color:inherit}}`;
const shell = (title, body, kind = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="VitaRecall fictional-data memory demonstration, exact evidence and submission resources."><title>${esc(title)}</title><style>${css}</style></head><body><nav><b>VitaRecall / Field notes</b><a href="index.html">Start</a><a href="article.html">Article</a><a href="evidence.html">Evidence</a><a href="guide.html">Guide</a><a href="demo.html">Demo</a></nav><main class="${kind}">${body}<footer>Prepared October 1, 2026 · Fictional-data pilot · AI companion, not a doctor.<br>Local/public-ready package. This page does not confirm publication or hackathon submission.</footer></main></body></html>`;

for (const key of ['before','save','after','correct','updated']) {
  assert.ok(proof.stages[key]?.completedAt, `Missing completed stage ${key}`);
  assert.equal(proof.stages[key].memoryTrace.historyUsed, false);
}
assert.equal(proof.stages.before.prompt, proof.stages.after.prompt);
assert.equal(proof.stages.before.prompt, proof.stages.updated.prompt);
assert.equal(proof.stages.before.sourceBlobIds.length, 0);
const original = proof.stages.save.receipts[0].blobId;
const correction = proof.stages.correct.receipts[0].blobId;
assert.ok(proof.stages.after.sourceBlobIds.includes(original));
assert.ok(proof.stages.updated.sourceBlobIds.includes(correction));
const source = read('ARTICLE.md');
assert.ok(!source.includes('CORRECTION_RESULT'), 'Article still has a pending result.');
writeFileSync(resolve(root, 'article.html'), shell('A New Chat Should Not Mean Starting From Zero — VitaRecall', markdown(source), 'article'));
writeFileSync(resolve(root, 'guide.html'), shell('Submission preparation guide — VitaRecall', markdown(read('SUBMISSION-GUIDE.md'))));
writeFileSync(resolve(root, 'demo.html'), shell('Before/after demonstration — VitaRecall', markdown(read('DEMO.md'))));

const stages = Object.entries(proof.stages).map(([key, stage], index) => {
  const names = { before:'Before: no saved preferences', save:'Save the original preference', after:'Return: original preference recalled', correct:'Save the correction', updated:'Return: newer preference followed' };
  const receipts = (stage.receipts || []).map(r => `<div class="note"><strong>Confirmed mainnet receipt</strong><br><a href="${esc(r.walrusScanUrl)}"><code>${esc(r.blobId)}</code></a><br><span class="meta">Job: ${esc(r.jobId)} · Aggregator HTTP ${r.aggregatorStatus} · ${r.encryptedBytes} encrypted bytes<br>SHA-256: <code>${esc(r.encryptedSha256)}</code></span></div>`).join('');
  const screenshot = stage.screenshot && key !== 'before' ? `<details><summary>Actual response capture</summary><img src="${esc(stage.screenshot)}" alt="Actual Vita response at the ${esc(key)} checkpoint"><p class="meta">${esc(stage.screenshotNote || 'Actual app capture. No text edited.')}</p></details>` : '';
  return `<section class="step"><p class="eyebrow">Step ${index+1} / ${esc(stage.capturedAt)}</p><h2>${names[key]}</h2><span class="pill">${stage.memoryTrace.sourceCount} sources</span><span class="pill">Previous history: not sent</span><span class="pill">New saves: ${stage.automaticSavingDuringExchange?'on':'paused'}</span><h3>Exact prompt</h3><blockquote>${esc(stage.prompt)}</blockquote><h3>Actual Gemini response</h3><div class="transcript">${markdown(stage.response)}</div>${stage.sourceBlobIds.length?'<p class="meta">Retrieved sources:<br>'+stage.sourceBlobIds.map(id=>`<a href="https://walruscan.com/mainnet/blob/${encodeURIComponent(id)}"><code>${esc(id)}</code></a>`).join('<br>')+'</p>':''}${receipts}${screenshot}</section>`;
}).join('');
const evidenceIntro = `<p class="eyebrow">Controlled live demonstration / 01 October 2026</p><h1>Not just stored.<br>Used in the next conversation.</h1><p>One fictional profile. The identical neutral question at three checkpoints. Real mainnet receipts and unedited model responses.</p><a class="button" href="https://vitarecall.vercel.app">Open the live app</a><a class="button" href="evidence.json">Inspect the raw evidence</a><p><a href="https://github.com/Tolex081/vitarecall">Source and setup</a> · <a href="demo.html">Reproduction and video plan</a></p><div class="note"><strong>Scope, not a leaderboard score.</strong> ${esc(proof.design)} Read-back answers were not archived. Saving was enabled only for the two preference-bearing exchanges. Normal new profiles default to saving on. No claim of five completed volunteers, clinical validation, exhaustive recall, permanent retention or verified agent-wide eligibility is made here.</div><div class="cards"><div class="card"><div class="stat">2</div><p>Distinct confirmed mainnet blobs in this controlled run—not two people or an agent-wide count.</p></div><div class="card"><div class="stat">2</div><p>Fresh-chat return checkpoints with matching sources. One original preference and one correction.</p></div></div><div class="table-wrap"><table><tr><th>Checkpoint</th><th>Observed behavior</th></tr><tr><td>Before saving</td><td>Explicitly no saved preferences; generic preparation answer.</td></tr><tr><td>After original save</td><td>Uses Mira, three numbered items, written questions last.</td></tr><tr><td>After correction</td><td>One unnumbered paragraph; transport last. Both sources retrieved.</td></tr></table></div><p class="meta">Application commit: <code>${esc(proof.appCommit)}</code><br>Model: ${esc(proof.model)} · Mainnet · Exact UTC timestamps below. Observed behavior was reviewed for this single run, not an aggregate success rate.</p>`;
writeFileSync(resolve(root, 'evidence.html'), shell('Verifiable memory evidence — VitaRecall', evidenceIntro + stages + `<h2>What this does not prove</h2><p>A stored blob is not a transaction digest. Retrieval does not prove every source influenced an answer. One successful correction does not guarantee conflict resolution in longer histories. The relayer handles plaintext and Gemini receives recalled context. Independent multi-day use still needs its own consented evidence.</p><img class="mobile-shot" src="assets/updated-mobile.png" alt="Actual 390-pixel mobile viewport after the corrected return"><p class="meta">Ordinary mobile viewport, without reading-view layout changes.</p>`));
const index = `<p class="eyebrow">Article · Evidence · Submission</p><h1>A stronger story.<br>Proof you can inspect.</h1><p>Your VitaRecall publishing kit: a Medium-ready narrative, custom Walrus artwork, the real before/after experiment, and a practical submission plan.</p><img src="assets/walrus-cover.png" alt="VitaRecall's AI-generated walrus companion connecting conversations"><p class="meta">Custom generated illustration, not evidence or an official endorsement.</p><div class="cards"><div class="card"><h2>Read the article</h2><p>The human story, integration, correction test and honest limits. Review your byline and add independent tester findings before the final submission.</p><a href="article.html">Open the formatted article →</a><br><a href="ARTICLE.md">Editable Markdown</a></div><div class="card"><h2>Inspect the proof</h2><p>Exact prompts and answers, no-history traces, source IDs, mainnet receipts, timestamps and encrypted download checks.</p><a href="evidence.html">Open the evidence page →</a></div><div class="card"><h2>Prepare the entry</h2><p>Readiness board, real-use plan, field-ready copy, feedback proposal, publishing steps and owner handoff sheet.</p><a href="guide.html">Open the submission guide →</a></div><div class="card"><h2>Show the difference</h2><p>A 90-second story and three-minute walkthrough. Real captures, not invented output or staged return dates.</p><a href="demo.html">Open the demo plan →</a></div></div><div class="note"><strong>Deadline: October 9, 15:00 Lagos / 14:00 UTC.</strong> Still required: independent tester evidence, verified agent identity/count, dedicated wallet, final publication and submission confirmations. This package does not submit or publish on your behalf.</div><p><a href="ASSETS.md">Image captions and upload notes</a> · <a href="ARTWORK-PROMPTS.json">Artwork prompts and provenance</a> · <a href="https://thewalrussessions.wal.app/chatbots/index.html">Official rules</a></p>`;
writeFileSync(resolve(root, 'index.html'), shell('VitaRecall submission studio', index));

const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true });
try {
  const page = await browser.newPage({ viewport: { width:1500, height:920 }, deviceScaleFactor:1.5 });
  await page.goto(pathToFileURL(resolve(root, 'assets/architecture.svg')).href);
  await page.screenshot({ path:resolve(root, 'assets/architecture.png') });
  for (const name of ['index.html','article.html','evidence.html','guide.html','demo.html']) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height:1000 });
      await page.goto(pathToFileURL(resolve(root, name)).href);
      await page.evaluate(async () => { for (const img of document.images) { img.loading='eager'; try { await img.decode(); } catch {} } });
      const result = await page.evaluate(() => ({ overflow:document.documentElement.scrollWidth>innerWidth, brokenImages:[...document.images].filter(img=>!img.naturalWidth).map(img=>img.getAttribute('src')) }));
      assert.equal(result.overflow, false, `Horizontal overflow: ${name}/${width}`);
      assert.deepEqual(result.brokenImages, [], `Broken images: ${name}/${width}`);
      if (width === 1440 && ['index.html','article.html'].includes(name)) await page.screenshot({ path:resolve('data', `submission-preview-${name.replace('.html','')}.png`), fullPage:false });
    }
  }
} finally { await browser.close(); }
for (const name of readdirSync(root).filter(file=>/\.(html|md)$/.test(file))) {
  const text = read(name);
  for (const match of text.matchAll(/(?:src|href)="([^"#]+)(?:#[^"]*)?"/g)) {
    const target=match[1];
    if (/^https?:/.test(target)) continue;
    assert.ok(existsSync(resolve(dirname(resolve(root,name)),target)), `Missing local link ${name}: ${target}`);
  }
}
console.log(JSON.stringify({ built:['index.html','article.html','evidence.html','guide.html','demo.html','assets/architecture.png'], responsiveChecks:10, evidenceConsistency:'passed', articleWords:source.split(/\s+/).length }));
