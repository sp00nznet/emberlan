/**
 * Stream proxy for media bots: lets the browser, desktop and Android apps play Plex/Jellyfin/
 * Emby/IPTV streams and thumbnails without CORS, through GET /api/stream/proxy?u=<sealed>.
 *
 * The upstream URL is encrypted (AES-256-GCM) into the link, so:
 * - clients never see it (Plex tokens and Jellyfin/Emby API keys live in those URLs), and
 * - the proxy only fetches URLs the server itself issued. It needs no login (hls.js and <video>
 *   fetch segments without headers), and an open proxy would let anyone who can reach the server
 *   make it fetch anything on the server's network.
 */
const crypto = require('crypto');

// ponytail: per-process key, so links stop working after a server restart; bots hand out
// fresh links on every play, which is when clients use them.
const KEY = crypto.randomBytes(32);

function seal(url) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([c.update(url, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

/** The upstream URL inside a link, or null if the link wasn't issued by this server. */
function open(token) {
  try {
    const b = Buffer.from(String(token), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Server-relative proxy link for an upstream URL. Clients put their server address in front. */
const proxyUrl = (url) => (url ? `/api/stream/proxy?u=${seal(url)}` : null);

/** Rewrite every URI in an HLS playlist (segments, variant playlists, keys) to a proxy link. */
function rewriteManifest(text, manifestUrl) {
  const abs = (u) => new URL(u, manifestUrl).href;
  return text.split('\n').map((raw) => {
    const line = raw.trim();
    if (!line) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxyUrl(abs(u))}"`);
    return proxyUrl(abs(line));
  }).join('\n');
}

module.exports = { proxyUrl, open, rewriteManifest };
