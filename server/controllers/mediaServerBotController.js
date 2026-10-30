// HTTP API for the Plex, Jellyfin and Emby bots (services/mediaServerBot.js), mounted at
// /api/admin/:bot(plex|jellyfin|emby)-bot/. routes/api.js says who may call what.
const Channel = require('../models/Channel');

// Errors from the services are meant for the user (bad URL, not set up, server down).
const route = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
};

// Playing or stopping in a voice channel: be in it, or be an admin.
async function assertInVoice(req, channelId) {
  if (['admin', 'superadmin'].includes(req.user.role)) return;
  const inIt = channelId && await Channel.exists({ _id: channelId, 'currentUsers.user': req.user._id });
  if (!inIt) throw Object.assign(new Error('Join that voice channel first'), { status: 403 });
}

function createMediaServerBotController(getService) {
  const svc = (req) => {
    const s = getService(req);
    if (!s) throw Object.assign(new Error('Bot service not running'), { status: 503 });
    return s;
  };
  const who = (req) => req.user.displayName || req.user.username;
  return {
    getStatus: route((req) => svc(req).getStatus(['admin', 'superadmin'].includes(req.user.role))),
    setEnabled: route((req) => svc(req).setEnabled(req.body.enabled)),
    connect: route((req) => svc(req).connect(req.body.serverUrl, req.body.token || req.body.apiKey)),
    disconnect: route((req) => svc(req).disconnect()),
    search: route(async (req) => ({ results: await svc(req).search(String(req.query.query || '').trim()) })),
    play: route(async (req) => {
      await assertInVoice(req, req.body.channelId);
      return svc(req).play(req.body.channelId, req.body.itemId, who(req));
    }),
    stop: route(async (req) => {
      await assertInVoice(req, req.body.channelId);
      return svc(req).stop(req.body.channelId);
    }),
  };
}

module.exports = { createMediaServerBotController, assertInVoice, route };
