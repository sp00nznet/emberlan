/**
 * Bot Registry
 * Central registry for bot services to allow querying active sessions
 */

const registeredBots = {};

const register = (name, service) => {
  registeredBots[name] = service;
  console.log(`[BotRegistry] Registered bot: ${name}`);
};

const get = (name) => registeredBots[name] || null;

// What someone joining a voice channel should see: bots that implement sessionFor(channelId)
// answer for themselves; the older ones are read field by field below.
const getActiveSessionsForChannel = (channelId) => {
  const activeSessions = [];
  for (const [type, bot] of Object.entries(registeredBots)) {
    const s = bot.sessionFor?.(String(channelId));
    if (s) activeSessions.push({ type, ...s });
  }

  // Check Chrome bot
  if (registeredBots.chrome?.activeSessions?.[channelId]) {
    const session = registeredBots.chrome.activeSessions[channelId];
    activeSessions.push({
      type: 'chrome',
      event: 'chrome:session-started',
      data: {
        channelId,
        url: session.url,
        controller: session.controller
      }
    });
  }

  // Check Twitch bot
  if (registeredBots.twitch?.activeStreams?.get?.(channelId)) {
    const session = registeredBots.twitch.activeStreams.get(channelId);
    activeSessions.push({
      type: 'twitch',
      event: 'twitch:started',
      data: {
        channelId,
        streamer: session.streamer,
        embedUrl: session.embedUrl
      }
    });
  }

  return activeSessions;
};

module.exports = {
  register,
  get,
  getActiveSessionsForChannel
};
