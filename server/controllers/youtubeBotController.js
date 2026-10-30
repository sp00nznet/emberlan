// HTTP API for the YouTube bot (services/youtubeBotService.js). routes/api.js says who may call what.
const { route, assertInVoice } = require('./mediaServerBotController');

let svc = null;
const s = () => {
  if (!svc) throw Object.assign(new Error('YouTube bot service not running'), { status: 503 });
  return svc;
};

module.exports = {
  initialize: (service) => { svc = service; },
  getStatus: route(() => s().getStatus()),
  setEnabled: route((req) => s().setEnabled(req.body.enabled)),
  getVideoInfo: route((req) => s().getVideoInfo(req.query.url)),
  play: route(async (req) => {
    await assertInVoice(req, req.body.channelId);
    return s().play(req.body.channelId, req.body.url, req.user.displayName || req.user.username);
  }),
  stop: route(async (req) => {
    await assertInVoice(req, req.body.channelId);
    return s().stop(req.body.channelId);
  }),
};
