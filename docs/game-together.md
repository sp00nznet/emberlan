# Game Together

Game Together is meant to let remote players play a local-multiplayer game: each remote player's
gamepad drives a virtual controller (Player 2, 3, 4) on the machine running the game.

## What works today

- Session bookkeeping: a host starts a session for a voice channel, others join and get a player
  slot (up to 4), and everyone sees `gameTogether:session-started`, `player-joined`,
  `player-left` and `session-stopped`.
- Remote players' browsers read their gamepad with the HTML5 Gamepad API and send
  `gameTogether:input` over Socket.IO; the server acknowledges with
  `gameTogether:input-received`.

## Touch gamepad (Android and phones)

`client/public/touchpad.js` draws an on-screen controller during a Game Together session when no
physical controller is connected. A USB or Bluetooth pad seen by the Gamepad API always wins and
hides it; it comes back if that pad disconnects. Two fingers work at once (for example A plus the
left stick). Double-tap a stick for a stick click. **Edit layout** lets you drag any control or hide
it with ×; size and opacity sliders and **Reset** sit beside it. The layout is saved per device in
`localStorage`. It is part of the shared UI, so a phone browser gets it as well as the Android app.

## What does not

- **No virtual controller is created on any platform.** `server/services/gameTogetherService.js`
  has three backends, and none drives a device:
  - Windows (`WindowsViGEmBackend`): `checkViGEmAvailable()` always returns `false`, so it is never
    used, even with ViGEmBus installed.
  - Linux (`LinuxUInputBackend`): reports available when `/dev/uinput` is accessible, then only
    stores button and axis state in memory; nothing is written to `/dev/uinput`.
  - macOS gets a stub foohid backend and any other platform a mock that also only stores state.
    (macOS is not a supported server platform.)
- **The remote players cannot see the game**, because screen share carries no video yet (see the
  README Status).
- The virtual controllers would be created on the **server's** machine, so the game has to run on
  the machine hosting the Emberlan server (for example the desktop app's embedded server). In
  Docker, `docker-compose.yml` passes `/dev/uinput` into the server container for this reason.

Making it real needs a ViGEm binding on Windows, uinput writes on Linux, (the host's screen share already reaches players over WebRTC).

## Admin

Settings > Media Bots > Game Together enables it (`POST /api/admin/game-together/enable`) and shows
whether a backend is available (`GET /api/admin/game-together/status`).

## API

All under `/api/admin/game-together/`, JWT required; `status` and `enable` are admin only.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `status` | | enabled flag, backend availability |
| POST | `enable` | `{ enabled }` | turn the feature on or off |
| POST | `start` | `{ channelId }` | start a session as host |
| POST | `stop` | `{ channelId }` | stop it (host) |
| GET | `sessions` | | active sessions |
| GET | `session/:channelId` | | one session |
| POST | `join` | `{ channelId }` | join, returns `{ playerSlot }` |
| POST | `leave` | `{ channelId }` | leave |
| POST | `input` | `{ channelId, inputData }` | input over HTTP (the UI uses the socket event instead) |

Socket.IO: client sends `gameTogether:input` `{ channelId, inputData }`; server sends
`gameTogether:session-started` `{ channelId, hostUserId, hostUsername, maxPlayers }`,
`gameTogether:session-stopped` `{ channelId }`,
`gameTogether:player-joined` `{ channelId, userId, username, playerSlot, playerCount }`,
`gameTogether:player-left` `{ channelId, userId, playerSlot, playerCount }`,
`gameTogether:input-received` `{ channelId, userId, timestamp }`.

Inputs map to the Xbox 360 layout: A, B, X, Y, LB, RB, BACK, START, LS, RS, D-pad, GUIDE; left
and right stick X/Y; LT and RT.
