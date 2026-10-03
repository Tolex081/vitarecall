// Produces a copy/paste draft for Medium when its editor rejects external URLs.
// The verified web article keeps its source links; this copy intentionally has
// none. Image markers remind the author to upload the actual local PNGs.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const submission = resolve('docs/submission');
const source = readFileSync(resolve(submission, 'ARTICLE.md'), 'utf8').replace(/\r\n/g, '\n');
const images = new Map([
  ['assets/walrus-cover.png', '01 — walrus-cover.png'],
  ['assets/after-answer.png', '02 — after-answer.png'],
  ['assets/architecture.png', '03 — architecture.png'],
  ['assets/walrus-changing-preferences.png', '04 — walrus-changing-preferences.png'],
  ['assets/updated-answer.png', '05 — updated-answer.png'],
  ['assets/correct-receipts.png', '06 — correct-receipts.png'],
]);

let article = source.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, path) => {
  const name = images.get(path);
  assert.ok(name, `Unknown article image: ${path}`);
  return `[IMAGE TO UPLOAD: ${name}]\nAlt text: ${alt}`;
});
article = article.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1');
article = article.replace('Try the fictional-data demo · Explore the source · Inspect the evidence', 'The public demo, source code, and evidence are available from the VitaRecall project page.');
article = article.replace('Open VitaRecall · Source and setup · Exact experiment and receipts · Reproduction guide', 'The public demo, source code, exact experiment, receipts, and reproduction guide are available from the VitaRecall project page.');

const guide = `# Medium paste-in copy — VitaRecall

This is a **no-link publishing copy** of the verified article. It contains no URLs, Markdown hyperlinks, or local image paths. Paste the article starting after the line below into a new Medium draft.

Before publishing, replace each \`[IMAGE TO UPLOAD…]\` marker with the matching image from \`docs/submission/assets/\`. The marker includes usable alt text. Do not paste the marker itself into the finished article.

The project’s public evidence, repository, demo, and mainnet receipts remain available from the VitaRecall submission studio. Add those links later only if Medium accepts them; this version is designed to publish without them.

---

${article}`;

assert.doesNotMatch(article, /https?:\/\//i, 'Medium article must not contain URLs.');
assert.doesNotMatch(article, /\]\([^)]*\)/, 'Medium article must not contain Markdown links.');
assert.doesNotMatch(article, /!\[/, 'Medium article must not contain Markdown images.');
assert.doesNotMatch(article, /assets\//, 'Medium article must not contain local image paths.');
writeFileSync(resolve(submission, 'MEDIUM-ARTICLE.md'), guide.replaceAll('\n', '\r\n'));
console.log(JSON.stringify({ output: 'docs/submission/MEDIUM-ARTICLE.md', urls: 0, imageMarkers: images.size, articleWords: article.split(/\s+/).length }));
