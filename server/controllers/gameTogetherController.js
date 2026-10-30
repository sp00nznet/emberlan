// HTTP API for Game Together (see server/services/gameTogetherService.js).
let service = null;

const initialize = (s) => { service = s; };
const me = (req) => [req.user._id.toString(), req.user.displayName || req.user.username];

// Wrap a handler: service errors become 400 with the message.
const route = (fn) => (req, res) => {
  try { res.json(fn(req)); } catch (e) { res.status(400).json({ error: e.message }); }
};

module.exports = {
  initialize,
  userLeftVoice: (channelId, userId) => service?.userLeftVoice(channelId, userId),
  getStatus: route(() => service.getStatus()),
  setEnabled: route((req) => service.setEnabled(req.body.enabled)),
  startSession: route((req) => service.startSession(req.body.channelId, ...me(req))),
  stopSession: route((req) => service.stopSession(req.body.channelId, me(req)[0])),
  getSessions: route(() => ({ sessions: service.getAllSessions() })),
  getSession: route((req) => ({ session: service.getSession(req.params.channelId) })),
  joinAsPlayer: route((req) => service.joinPlayer(req.body.channelId, ...me(req))),
  leaveAsPlayer: route((req) => service.leavePlayer(req.body.channelId, me(req)[0])),
};
