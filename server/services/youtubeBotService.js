/**
 * YouTube bot: everyone in a voice channel watches the same YouTube video (the official embed
 * player in each client). The server only checks the link and looks up title/thumbnail through
 * YouTube's oEmbed endpoint; if that lookup fails the video still plays.
 */
const BotSettings = require('../models/BotSettings');

// The harness points this at a fake; real servers use YouTube's.
const OEMBED = process.env.YOUTUBE_OEMBED_URL || 'https://www.youtube.com/oembed';

/** The 11-character video id in any common YouTube link, or null. */
function videoIdOf(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') || (/^\/(embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname) || [])[2];
  }
  return id && /^[\w-]{11}$/.test(id.slice(0, 11)) ? id.slice(0, 11) : null;
}

class YouTubeBotService {
  constructor(io) {
    this.io = io;
    this.enabled = false;
    this.activeStreams = {}; // channelId -> session
    this.ready = BotSettings.findOne({ botType: 'youtube' })
      .then((s) => { if (s) this.enabled = !!s.enabled; })
      .catch((e) => console.error('[YouTube] loading settings failed:', e.message));
  }

  async setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) this.stopAll();
    await BotSettings.findOneAndUpdate({ botType: 'youtube' }, { botType: 'youtube', enabled: this.enabled, updatedAt: new Date() }, { upsert: true }).exec();
    return { enabled: this.enabled };
  }

  async getVideoInfo(url) {
    const videoId = videoIdOf(url);
    if (!videoId) throw new Error("That doesn't look like a YouTube link");
    const info = { videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: 'YouTube video', author: null,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
    try {
      const fetch = (await import('node-fetch')).default;
      const r = await fetch(`${OEMBED}?format=json&url=${encodeURIComponent(info.url)}`, { timeout: 4000 });
      if (r.ok) {
        const j = await r.json();
        Object.assign(info, { title: j.title || info.title, author: j.author_name || null, thumbnail: j.thumbnail_url || info.thumbnail });
      }
    } catch { /* offline or blocked: play with the defaults */ }
    return info;
  }

  async play(channelId, url, requestedBy) {
    if (!this.enabled) throw new Error('YouTube bot is turned off');
    if (!channelId) throw new Error('channelId is required');
    const info = await this.getVideoInfo(url);
    const session = { channelId, ...info, requestedBy, startTime: Date.now() };
    this.activeStreams[channelId] = session;
    this.io.to(`voice:${channelId}`).emit('youtube:playing', session);
    return session;
  }

  stop(channelId) {
    if (!this.activeStreams[channelId]) return { stopped: false };
    delete this.activeStreams[channelId];
    this.io.to(`voice:${channelId}`).emit('youtube:stopped', { channelId });
    return { stopped: true };
  }

  stopAll() {
    for (const id of Object.keys(this.activeStreams)) this.stop(id);
  }

  sessionFor(channelId) {
    const s = this.activeStreams[channelId];
    return s && { event: 'youtube:playing', data: s };
  }

  getStatus() {
    return { enabled: this.enabled, activeStreams: Object.values(this.activeStreams) };
  }
}

module.exports = { YouTubeBotService, videoIdOf };
