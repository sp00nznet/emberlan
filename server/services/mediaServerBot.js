/**
 * Plex, Jellyfin and Emby bots: search a media server and play an item to everyone in a voice
 * channel. One service, three adapters; the three used to be near-copies with the same bugs.
 *
 * - Streams and thumbnails go through the stream proxy (streamProxy.js), so clients never see
 *   the server's token or API key and nothing hits CORS.
 * - Video plays as HLS the media server transcodes (or the file itself when browsers can play it);
 *   audio as MP3.
 * - Settings persist in BotSettings. If the server is unreachable at startup the settings are kept
 *   and the bot reconnects on the next search or play.
 */
const BotSettings = require('../models/BotSettings');
const { proxyUrl } = require('./streamProxy');

const fetchJson = async (url, headers = {}) => {
  const fetch = (await import('node-fetch')).default;
  const r = await fetch(url, { headers: { Accept: 'application/json', ...headers }, timeout: 10000 });
  if (!r.ok) throw new Error(`${new URL(url).pathname} returned ${r.status}`);
  return r.json();
};

// Containers a browser <video>/<audio> plays directly; anything else gets transcoded.
const BROWSER_SAFE = /^(mp4|m4v|m4a|mp3|webm|aac)$/i;

const plex = {
  name: 'Plex',
  credential: 'token',
  async connect({ serverUrl, token }) {
    const h = { 'X-Plex-Token': token };
    const c = (await fetchJson(`${serverUrl}/`, h)).MediaContainer || {};
    return { name: c.friendlyName || 'Plex Media Server', version: c.version, id: c.machineIdentifier };
  },
  async search({ serverUrl, token }, query) {
    const data = await fetchJson(`${serverUrl}/hubs/search?query=${encodeURIComponent(query)}&limit=20`, { 'X-Plex-Token': token });
    return (data.MediaContainer?.Hub || []).flatMap((hub) => hub.Metadata || [])
      .filter((m) => ['movie', 'episode', 'track', 'clip'].includes(m.type))
      .map((m) => plex.item({ serverUrl, token }, m));
  },
  item({ serverUrl, token }, m) {
    return {
      id: String(m.ratingKey), title: m.title, type: m.type, year: m.year,
      artist: m.type === 'track' ? m.grandparentTitle : undefined,
      show: m.type === 'episode' ? m.grandparentTitle : undefined,
      duration: m.duration ? Math.round(m.duration / 1000) : null,
      thumb: m.thumb ? proxyUrl(`${serverUrl}${m.thumb}?X-Plex-Token=${token}`) : null,
      kind: m.type === 'track' ? 'audio' : 'video',
    };
  },
  async stream({ serverUrl, token }, id) {
    const m = (await fetchJson(`${serverUrl}/library/metadata/${id}`, { 'X-Plex-Token': token })).MediaContainer?.Metadata?.[0];
    if (!m) throw new Error('Item not found on the Plex server');
    const item = plex.item({ serverUrl, token }, m);
    const media = m.Media?.[0];
    const part = media?.Part?.[0];
    if (part?.key && BROWSER_SAFE.test(media.container || part.container || '')) {
      return { item, url: `${serverUrl}${part.key}?X-Plex-Token=${token}`, format: 'file' };
    }
    // Plex transcodes everything else to HLS.
    const q = new URLSearchParams({
      path: `/library/metadata/${id}`, mediaIndex: '0', partIndex: '0', protocol: 'hls', directPlay: '0', directStream: '1',
      fastSeek: '1', session: `emberlan-${Date.now()}`, 'X-Plex-Client-Identifier': 'emberlan', 'X-Plex-Product': 'Emberlan',
      'X-Plex-Platform': 'Chrome', 'X-Plex-Token': token,
    });
    const kind = item.kind === 'audio' ? 'music' : 'video';
    return { item, url: `${serverUrl}/${kind}/:/transcode/universal/start.m3u8?${q}`, format: 'hls' };
  },
};

// Jellyfin and Emby share the MediaBrowser API.
const mediaBrowser = (name, authHeader) => {
  const self = {
    name,
    credential: 'apiKey',
    async connect({ serverUrl, apiKey }) {
      const info = await fetchJson(`${serverUrl}/System/Info`, authHeader(apiKey)); // needs a valid key
      const users = await fetchJson(`${serverUrl}/Users`, authHeader(apiKey));
      if (!Array.isArray(users) || !users.length) throw new Error('The server has no users to browse as');
      return { name: info.ServerName || name, version: info.Version, id: info.Id, userId: users[0].Id };
    },
    async search(cfg, query) {
      const q = new URLSearchParams({ SearchTerm: query, Recursive: 'true', Limit: '20',
        IncludeItemTypes: 'Movie,Episode,Audio,MusicVideo,Video', Fields: 'MediaSources' });
      const data = await fetchJson(`${cfg.serverUrl}/Users/${cfg.userId}/Items?${q}`, authHeader(cfg.apiKey));
      return (data.Items || []).map((i) => self.item(cfg, i));
    },
    item({ serverUrl, apiKey }, i) {
      return {
        id: i.Id, title: i.Name, type: i.Type, year: i.ProductionYear,
        artist: i.AlbumArtist || i.Artists?.[0], show: i.SeriesName,
        duration: i.RunTimeTicks ? Math.round(i.RunTimeTicks / 1e7) : null,
        thumb: i.ImageTags?.Primary ? proxyUrl(`${serverUrl}/Items/${i.Id}/Images/Primary?maxHeight=300&api_key=${apiKey}`) : null,
        kind: i.MediaType === 'Audio' || i.Type === 'Audio' ? 'audio' : 'video',
      };
    },
    async stream(cfg, id) {
      const i = await fetchJson(`${cfg.serverUrl}/Users/${cfg.userId}/Items/${id}`, authHeader(cfg.apiKey));
      const item = self.item(cfg, i);
      const key = `api_key=${cfg.apiKey}`;
      if (item.kind === 'audio') {
        return { item, url: `${cfg.serverUrl}/Audio/${id}/universal?${key}&UserId=${cfg.userId}&Container=mp3&AudioCodec=mp3&TranscodingContainer=mp3`, format: 'file' };
      }
      const q = `${key}&MediaSourceId=${id}&VideoCodec=h264&AudioCodec=aac&TranscodingContainer=ts&TranscodingProtocol=hls&SegmentContainer=ts`;
      return { item, url: `${cfg.serverUrl}/Videos/${id}/master.m3u8?${q}`, format: 'hls' };
    },
  };
  return self;
};

const ADAPTERS = {
  plex,
  jellyfin: mediaBrowser('Jellyfin', (k) => ({ Authorization: `MediaBrowser Token="${k}"` })),
  emby: mediaBrowser('Emby', (k) => ({ 'X-Emby-Token': k })),
};

class MediaServerBot {
  constructor(io, type) {
    this.io = io;
    this.type = type;
    this.adapter = ADAPTERS[type];
    this.enabled = false;
    this.config = null; // { serverUrl, token|apiKey, userId }
    this.serverInfo = null;
    this.lastError = null;
    this.activeStreams = {}; // channelId -> what was announced in media:playing
    this.ready = this.load();
  }

  get connected() { return !!this.serverInfo; }

  async load() {
    try {
      const s = await BotSettings.findOne({ botType: this.type });
      if (!s) return;
      this.enabled = !!s.enabled;
      if (s.config?.serverUrl) {
        this.config = s.config;
        await this.reconnect().catch(() => {});
      }
    } catch (e) {
      console.error(`[${this.adapter.name}] loading settings failed:`, e.message);
    }
  }

  save() {
    return BotSettings.findOneAndUpdate(
      { botType: this.type },
      { botType: this.type, enabled: this.enabled, config: this.config || {}, updatedAt: new Date() },
      { upsert: true },
    ).exec();
  }

  async reconnect() {
    try {
      const info = await this.adapter.connect(this.config);
      this.serverInfo = info;
      if (info.userId) this.config.userId = info.userId;
      this.lastError = null;
    } catch (e) {
      this.serverInfo = null;
      this.lastError = e.message;
      throw new Error(`Could not reach ${this.adapter.name}: ${e.message}`);
    }
  }

  // A saved server that was down at startup is retried here.
  async ensureConnected() {
    if (this.connected) return;
    if (!this.config) throw new Error(`${this.adapter.name} is not set up yet (an admin connects it in Bots)`);
    await this.reconnect();
  }

  async setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) this.stopAll();
    await this.save();
    return { enabled: this.enabled };
  }

  async connect(serverUrl, credential) {
    if (!serverUrl || !credential) throw new Error(`Server URL and ${this.adapter.credential} are required`);
    const prev = this.config;
    this.config = { serverUrl: serverUrl.replace(/\/+$/, ''), [this.adapter.credential]: credential };
    try {
      await this.reconnect();
    } catch (e) {
      this.config = prev;
      throw e;
    }
    await this.save();
    return { connected: true, serverInfo: this.publicInfo() };
  }

  async disconnect() {
    this.stopAll();
    this.config = null;
    this.serverInfo = null;
    await this.save();
    return { connected: false };
  }

  async search(query) {
    if (!query) return [];
    await this.ensureConnected();
    return this.adapter.search(this.config, query);
  }

  async play(channelId, id, requestedBy) {
    if (!this.enabled) throw new Error(`${this.adapter.name} bot is turned off`);
    if (!channelId || !id) throw new Error('channelId and item id are required');
    await this.ensureConnected();
    const { item, url, format } = await this.adapter.stream(this.config, id);
    const session = {
      source: this.adapter.name, channelId, itemId: item.id, title: item.title, artist: item.artist, type: item.type,
      kind: item.kind, duration: item.duration, thumbnail: item.thumb, streamUrl: proxyUrl(url), format,
      requestedBy, startTime: Date.now(),
    };
    this.activeStreams[channelId] = session;
    this.io.to(`voice:${channelId}`).emit('media:playing', session);
    return session;
  }

  stop(channelId) {
    if (!this.activeStreams[channelId]) return { stopped: false };
    delete this.activeStreams[channelId];
    this.io.to(`voice:${channelId}`).emit('media:stopped', { source: this.adapter.name, channelId });
    return { stopped: true };
  }

  stopAll() {
    for (const id of Object.keys(this.activeStreams)) this.stop(id);
  }

  /** What a late joiner of the voice channel needs to see (botRegistry). */
  sessionFor(channelId) {
    const s = this.activeStreams[channelId];
    return s && { event: 'media:playing', data: s };
  }

  publicInfo() {
    return this.serverInfo && { name: this.serverInfo.name, version: this.serverInfo.version };
  }

  // No credentials in here: any logged-in user can read it. Only admins see the server address.
  getStatus(isAdmin = false) {
    return {
      enabled: this.enabled,
      configured: !!this.config,
      connected: this.connected,
      serverInfo: this.publicInfo(),
      serverUrl: isAdmin ? this.config?.serverUrl || null : undefined,
      lastError: this.lastError,
      activeStreams: Object.values(this.activeStreams),
    };
  }
}

module.exports = { MediaServerBot, ADAPTERS };
