/**
 * IPTV bot: watch live TV channels from an M3U playlist together in a voice channel.
 *
 * - The playlist comes from an upload or a URL; the optional XMLTV guide (EPG) from a URL.
 * - Channel URLs often carry the provider account (user/password), so they never leave the
 *   server: clients get proxy links (streamProxy.js) and channel lists without URLs.
 * - On play the server probes the stream and tells clients how to play it: 'hls' (a playlist,
 *   whatever its URL looks like) or 'ts' (raw MPEG-TS).
 */
const BotSettings = require('../models/BotSettings');
const { proxyUrl } = require('./streamProxy');

const fetchOk = async (url, opts = {}) => {
  const fetch = (await import('node-fetch')).default;
  const r = await fetch(url, { headers: { 'User-Agent': 'Emberlan/1.0' }, timeout: 15000, ...opts });
  if (!r.ok) throw new Error(`${url.split('?')[0]} returned ${r.status}`);
  return r;
};

// #EXTINF:-1 tvg-id="x" tvg-logo="y" group-title="z",Name  (attributes in any order)
function parseM3U(text) {
  const channels = [];
  let info = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const attrs = Object.fromEntries([...line.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
      const comma = line.indexOf(',', line.lastIndexOf('"') + 1);
      info = { attrs, name: (comma > -1 ? line.slice(comma + 1) : '').trim() };
    } else if (line && !line.startsWith('#') && info) {
      const n = channels.length + 1;
      channels.push({
        id: `${info.attrs['tvg-id'] || 'ch'}#${n}`, // unique even when providers repeat tvg-ids
        tvgId: info.attrs['tvg-id'] || null,
        name: info.name || info.attrs['tvg-name'] || `Channel ${n}`,
        logo: info.attrs['tvg-logo'] || null,
        group: info.attrs['group-title'] || 'Uncategorized',
        url: line,
      });
      info = null;
    }
  }
  return channels;
}

// XMLTV time: "20261030193000 +0100" (offset optional, UTC when missing).
function xmltvTime(s) {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/.exec(s || '');
  if (!m) return null;
  const utc = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const off = m[7] ? (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(3)) : 0;
  return new Date(utc - off * 60000);
}

const unescapeXml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

// ponytail: regex XMLTV parser; fine for guides of a few MB. Use a SAX parser if large guides choke it.
function parseXMLTV(xml) {
  const epg = {}; // tvg-id -> [{ title, desc, start, stop }]
  for (const m of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
    const start = xmltvTime(attrs.start), stop = xmltvTime(attrs.stop);
    if (!attrs.channel || !title || !start || !stop) continue;
    const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
    (epg[attrs.channel] ||= []).push({ title: unescapeXml(title[1]), desc: desc ? unescapeXml(desc[1]) : '', start, stop });
  }
  for (const list of Object.values(epg)) list.sort((a, b) => a.start - b.start);
  return epg;
}

// Read the first bytes of a stream: an HLS playlist starts with #EXTM3U, MPEG-TS with 0x47.
async function probe(url) {
  const r = await fetchOk(url, { timeout: 10000 });
  const type = r.headers.get('content-type') || '';
  let head = Buffer.alloc(0);
  for await (const chunk of r.body) {
    head = Buffer.concat([head, chunk]);
    if (head.length >= 512) break;
  }
  r.body.destroy?.();
  if (head.toString('utf8', 0, 7) === '#EXTM3U' || /mpegurl/i.test(type)) return 'hls';
  if (head[0] === 0x47 || /mp2t/i.test(type)) return 'ts';
  if (/^(video|audio)\//i.test(type)) return 'file';
  throw new Error(`Unrecognized stream (${type || 'no content type'})`);
}

class IPTVBotService {
  constructor(io) {
    this.io = io;
    this.enabled = false;
    this.channels = [];
    this.playlistUrl = null; // null when uploaded
    this.epgUrl = null;
    this.epg = {};
    this.activeStreams = {}; // voice channelId -> session
    this.ready = this.load();
  }

  get configured() { return this.channels.length > 0; }

  async load() {
    try {
      const s = await BotSettings.findOne({ botType: 'iptv' });
      if (!s) return;
      this.enabled = !!s.enabled;
      this.channels = s.config?.channels || [];
      this.playlistUrl = s.config?.playlistUrl || null;
      this.epgUrl = s.config?.epgUrl || null;
      if (this.epgUrl) await this.loadEPG().catch((e) => console.error('[IPTV] guide reload failed:', e.message));
    } catch (e) {
      console.error('[IPTV] loading settings failed:', e.message);
    }
  }

  save() {
    return BotSettings.findOneAndUpdate(
      { botType: 'iptv' },
      { botType: 'iptv', enabled: this.enabled, config: { channels: this.channels, playlistUrl: this.playlistUrl, epgUrl: this.epgUrl }, updatedAt: new Date() },
      { upsert: true },
    ).exec();
  }

  async setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) this.stopAll();
    await this.save();
    return { enabled: this.enabled };
  }

  /** playlistText (an upload) or playlistUrl; epgUrl optional ('' clears it). */
  async configure({ playlistText, playlistUrl, epgUrl }) {
    if (!playlistText && !playlistUrl) throw new Error('Upload a playlist or give its URL');
    const text = playlistText ?? await (await fetchOk(playlistUrl)).text();
    const channels = parseM3U(text);
    if (!channels.length) throw new Error('No channels found in that playlist');
    this.channels = channels;
    this.playlistUrl = playlistText ? null : playlistUrl;
    this.epgUrl = epgUrl || null;
    this.epg = {};
    let epgError = null;
    if (this.epgUrl) await this.loadEPG().catch((e) => { epgError = e.message; });
    await this.save();
    return { configured: true, channelCount: channels.length, groupCount: this.getGroups().length, hasEPG: !!Object.keys(this.epg).length, epgError };
  }

  async loadEPG() {
    this.epg = parseXMLTV(await (await fetchOk(this.epgUrl)).text());
  }

  // What clients see of a channel: no stream URL, logo through the proxy.
  view(ch) {
    return { id: ch.id, name: ch.name, group: ch.group, logo: proxyUrl(ch.logo), now: this.nowPlaying(ch)?.title || null };
  }

  getChannels(group) {
    return this.channels.filter((c) => !group || c.group === group).map((c) => this.view(c));
  }

  getGroups() {
    const counts = {};
    for (const c of this.channels) counts[c.group] = (counts[c.group] || 0) + 1;
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }

  nowPlaying(ch, at = new Date()) {
    return (this.epg[ch.tvgId] || []).find((p) => p.start <= at && at < p.stop) || null;
  }

  getChannelEPG(channelId) {
    const ch = this.channels.find((c) => c.id === channelId);
    if (!ch) throw new Error('IPTV channel not found');
    const now = new Date();
    const programs = (this.epg[ch.tvgId] || []).filter((p) => p.stop > now).slice(0, 24)
      .map((p) => ({ ...p, isLive: p.start <= now && now < p.stop }));
    return { channel: this.view(ch), programs };
  }

  async play(voiceChannelId, iptvChannelId, requestedBy) {
    if (!this.enabled) throw new Error('IPTV bot is turned off');
    if (!this.configured) throw new Error('IPTV is not set up yet (an admin adds a playlist in Bots)');
    if (!voiceChannelId) throw new Error('voiceChannelId is required');
    const ch = this.channels.find((c) => c.id === iptvChannelId);
    if (!ch) throw new Error('IPTV channel not found');
    let format;
    try { format = await probe(ch.url); } catch (e) { throw new Error(`${ch.name} is not reachable: ${e.message}`); }
    const program = this.nowPlaying(ch);
    const session = {
      channelId: voiceChannelId, iptvChannelId: ch.id, channelName: ch.name, group: ch.group, logo: proxyUrl(ch.logo),
      currentProgram: program && { title: program.title, start: program.start, stop: program.stop },
      streamUrl: proxyUrl(ch.url), format, requestedBy, startTime: Date.now(),
    };
    this.activeStreams[voiceChannelId] = session;
    this.io.to(`voice:${voiceChannelId}`).emit('iptv:playing', session);
    return session;
  }

  stop(voiceChannelId) {
    if (!this.activeStreams[voiceChannelId]) return { stopped: false };
    delete this.activeStreams[voiceChannelId];
    this.io.to(`voice:${voiceChannelId}`).emit('iptv:stopped', { channelId: voiceChannelId });
    return { stopped: true };
  }

  stopAll() {
    for (const id of Object.keys(this.activeStreams)) this.stop(id);
  }

  sessionFor(channelId) {
    const s = this.activeStreams[channelId];
    return s && { event: 'iptv:playing', data: s };
  }

  getStatus() {
    return {
      enabled: this.enabled,
      configured: this.configured,
      channelCount: this.channels.length,
      groupCount: this.getGroups().length,
      hasEPG: Object.keys(this.epg).length > 0,
      playlistFrom: this.playlistUrl ? 'url' : this.configured ? 'upload' : null, // the URL itself may hold the account
      activeStreams: Object.values(this.activeStreams),
    };
  }
}

module.exports = { IPTVBotService, parseM3U, parseXMLTV, xmltvTime };
