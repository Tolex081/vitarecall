// Public handles go to Unavatar; no health information or credentials leave here.
// Fetch only the fixed service URL, reject redirects, and return a local fallback.
const MAX_BYTES = 512 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function fallback(username) {
  const hues = [...username].reduce((total, char) => total + char.charCodeAt(0), 0) % 360;
  const initials = username.replace(/_/g, '').slice(0, 2).toUpperCase() || 'V';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="hsl(${hues},35%,88%)"/><circle cx="76" cy="17" r="31" fill="hsl(${hues},40%,80%)"/><text x="48" y="59" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="#163f43">${initials}</text></svg>`);
}

export function createAvatarHandler(fetchImage = fetch) {
  const cache = new Map();
  const pending = new Map();
  async function resolve(username) {
    try {
      const response = await fetchImage(`https://unavatar.io/x/${encodeURIComponent(username)}?fallback=false`, {
        signal: AbortSignal.timeout(6000), redirect: 'error', headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
      });
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!response.ok || !ALLOWED_TYPES.has(type) || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Unavailable avatar');
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_BYTES) throw new Error('Oversized avatar');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!length) throw new Error('Empty avatar');
      return { bytes: Buffer.concat(chunks), type, source: 'unavatar', until: Date.now() + 3600000 };
    } catch {
      return { bytes: fallback(username), type: 'image/svg+xml', source: 'generated-fallback', until: Date.now() + 60000 };
    }
  }
  return async function avatar(req, res) {
    const username = String(req.params.username || '').toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(username) || username !== req.user?.username) return res.status(404).end();
    let result = cache.get(username);
    if (!result || result.until < Date.now()) {
      if (!pending.has(username)) pending.set(username, resolve(username));
      result = await pending.get(username);
      pending.delete(username);
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(username, result);
    }
    res.set({ 'Content-Type': result.type, 'Cache-Control': 'private, max-age=60', 'X-Avatar-Source': result.source });
    return res.send(result.bytes);
  };
}
