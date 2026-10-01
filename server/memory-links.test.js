import test from 'node:test';
import assert from 'node:assert/strict';
import { blobExplorerUrl } from '../src/memory-links.js';

test('blob links use the full Walrus Scan mainnet ID and encode path characters', () => {
  const id = 'nx6xjBi7-Lg-WJu34mObHMreFpowyUlLcbi-y8jGjxM';
  assert.equal(blobExplorerUrl(id), `https://walruscan.com/mainnet/blob/${id}`);
  assert.equal(blobExplorerUrl('a/b?c#d'), 'https://walruscan.com/mainnet/blob/a%2Fb%3Fc%23d');
});
