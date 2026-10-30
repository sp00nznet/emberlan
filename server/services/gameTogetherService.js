/**
 * Game Together: remote players join a host's local-multiplayer game.
 *
 * The server only keeps the books: who hosts which voice channel's session and
 * which player slot (2-4) each guest has. Controller input never touches the
 * server: guests send it peer-to-peer over the WebRTC data channel
 * (client/public/voice-rtc.js) to the host's desktop app, which feeds it to
 * virtual Xbox pads (electron-client/gamepads.js, ViGEmBus).
 */
const MAX_PLAYERS = 4;

class GameTogetherService {
  constructor(io) {
    this.io = io;
    this.enabled = true;
    this.sessions = new Map(); // channelId -> { hostUserId, hostUsername, startedAt, players: Map(userId -> player) }
  }

  room(channelId) { return this.io.to(`voice:${channelId}`); }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) for (const id of [...this.sessions.keys()]) this.end(id);
    return { success: true, enabled: this.enabled };
  }

  view(channelId) {
    const s = this.sessions.get(channelId);
    if (!s) return null;
    return {
      channelId, hostUserId: s.hostUserId, hostUsername: s.hostUsername, startedAt: s.startedAt,
      maxPlayers: MAX_PLAYERS, playerCount: s.players.size,
      players: [...s.players.values()].map(({ userId, username, playerSlot }) => ({ userId, username, playerSlot })),
    };
  }

  getStatus() {
    return { enabled: this.enabled, activeSessions: this.getAllSessions() };
  }

  getAllSessions() { return [...this.sessions.keys()].map((id) => this.view(id)); }
  getSession(channelId) { return this.view(channelId); }

  startSession(channelId, hostUserId, hostUsername) {
    if (!this.enabled) throw new Error('Game Together is turned off on this server');
    if (!channelId) throw new Error('channelId required');
    if (this.sessions.has(channelId)) throw new Error('A Game Together session is already running in this channel');
    const host = { userId: hostUserId, username: hostUsername, playerSlot: 1 };
    this.sessions.set(channelId, { hostUserId, hostUsername, startedAt: new Date(), players: new Map([[hostUserId, host]]) });
    const view = this.view(channelId);
    this.room(channelId).emit('gameTogether:session-started', view);
    return view;
  }

  stopSession(channelId, userId) {
    const s = this.sessions.get(channelId);
    if (!s) throw new Error('No active session in this channel');
    if (s.hostUserId !== userId) throw new Error('Only the host can stop the session');
    this.end(channelId);
    return { success: true };
  }

  end(channelId) {
    this.sessions.delete(channelId);
    this.room(channelId).emit('gameTogether:session-stopped', { channelId });
  }

  joinPlayer(channelId, userId, username) {
    const s = this.sessions.get(channelId);
    if (!s) throw new Error('No active session in this channel');
    if (s.players.has(userId)) return { success: true, playerSlot: s.players.get(userId).playerSlot, session: this.view(channelId) };
    const taken = new Set([...s.players.values()].map((p) => p.playerSlot));
    let playerSlot = 2;
    while (taken.has(playerSlot)) playerSlot++;
    if (playerSlot > MAX_PLAYERS) throw new Error(`Session is full (${MAX_PLAYERS} players)`);
    s.players.set(userId, { userId, username, playerSlot });
    this.room(channelId).emit('gameTogether:player-joined', { channelId, userId, username, playerSlot, playerCount: s.players.size });
    return { success: true, playerSlot, session: this.view(channelId) };
  }

  leavePlayer(channelId, userId) {
    const s = this.sessions.get(channelId);
    if (!s) throw new Error('No active session in this channel');
    if (userId === s.hostUserId) return this.stopSession(channelId, userId);
    const p = s.players.get(userId);
    if (!p) throw new Error('You are not in this session');
    s.players.delete(userId);
    this.room(channelId).emit('gameTogether:player-left', { channelId, userId, playerSlot: p.playerSlot, playerCount: s.players.size });
    return { success: true };
  }

  /** Called by the socket layer when someone leaves voice or disconnects. */
  userLeftVoice(channelId, userId) {
    const s = channelId && this.sessions.get(String(channelId));
    if (!s || !s.players.has(String(userId))) return;
    this.leavePlayer(String(channelId), String(userId));
  }
}

module.exports = GameTogetherService;
