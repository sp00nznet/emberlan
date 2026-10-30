// HTTP API for the IPTV bot (services/iptvBotService.js). routes/api.js says who may call what.
const { route, assertInVoice } = require('./mediaServerBotController');

let svc = null;
const s = () => {
  if (!svc) throw Object.assign(new Error('IPTV bot service not running'), { status: 503 });
  return svc;
};

module.exports = {
  initialize: (service) => { svc = service; },
  getStatus: route(() => s().getStatus()),
  setEnabled: route((req) => s().setEnabled(req.body.enabled)),
  // multipart: file field "playlist" and/or fields playlistUrl, epgUrl
  configure: route((req) => s().configure({
    playlistText: req.file ? req.file.buffer.toString('utf8') : undefined,
    playlistUrl: req.body.playlistUrl?.trim() || undefined,
    epgUrl: req.body.epgUrl?.trim() || undefined,
  })),
  getChannels: route((req) => ({ channels: s().getChannels(req.query.group) })),
  getGroups: route(() => ({ groups: s().getGroups() })),
  getEPG: route((req) => s().getChannelEPG(req.params.channelId)),
  play: route(async (req) => {
    await assertInVoice(req, req.body.voiceChannelId);
    return s().play(req.body.voiceChannelId, req.body.iptvChannelId, req.user.displayName || req.user.username);
  }),
  stop: route(async (req) => {
    await assertInVoice(req, req.body.voiceChannelId);
    return s().stop(req.body.voiceChannelId);
  }),
};
