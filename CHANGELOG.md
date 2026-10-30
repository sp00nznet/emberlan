# Changelog

All notable changes to Emberlan are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Media bots in the conformance harness (`conformance/bots.js`).
  - **Fake media server:** it speaks the Plex, Jellyfin, Emby, IPTV-provider and YouTube oEmbed
    APIs and serves real test media generated with ffmpeg (`conformance/media/`).
  - **Server checks:** setup, permissions, that no key reaches clients, the stream proxy, format
    detection, late joiners, and settings surviving a restart.
  - **UI checks:** a non-admin uses each dialog, and the media decodes in both users' browsers.
  - 240 checks in all.
- Game Together works end to end. Guests' controllers or phone touch pads drive virtual Xbox
  controllers (ViGEmBus) on the host's PC, created by the desktop app (`electron-client/gamepads.js`).
  - Input goes peer to peer over a WebRTC data channel, never through the server.
  - Guests get a full-screen play view of the host's screen share.
  - One Game Together dialog (🎮 Play in the voice panel) replaces two half-finished flows.
  - The harness plays a session across two tabs.
- Voice, camera and screen share between users over WebRTC (`client/public/voice-rtc.js`): a
  mesh with perfect negotiation, so streams can be added or removed mid-call. Deafen and the
  speaker setting apply. The UI corpus now runs a two-user call with fake devices and checks audio
  bytes both ways, camera on/off and leaving.
- On-screen touch gamepad for Game Together (`client/public/touchpad.js`), shown on touch
  devices when no physical controller is connected; a Gamepad API controller hides it. Editable
  layout, size and opacity, saved per device.
- UI conformance corpus: drives the real UI in headless Chrome/Edge (login, socket, channel,
  message, touch pad, no JS errors); `--screenshots` writes `docs/screenshots/`. The harness also
  fails on duplicate function names in `app.js`.
- GitHub Actions (`.github/workflows/ci.yml`): conformance on every push and PR to `main`; a `v*`
  tag builds the Windows installer (NSIS and portable) and the Android debug APK and creates a
  GitHub Release with notes from this file.
- NOTICE and `LICENSES/` for the vendored libraries.
- Conformance harness (`conformance/run.js`, [docs/conformance.md](docs/conformance.md)): a
  contract corpus (client API and socket calls against server routes and handlers, desktop and
  Android bridge parity, no Discord styling, required files) and a live corpus (the real server on
  an in-memory MongoDB, driving auth, chat, DMs, voice join and every client GET). Baseline in
  `conformance/results.json`, history in `conformance/history.csv`; exits 1 on regression.
- Ember redesign of the web client: login and server picker, app shell, IRC-style chat, members
  panel, DMs, voice view and ten settings panels.
- Editable server address on the desktop login screen.
- New logo and Windows icons (`electron-client/assets/icon.ico`, `icon.png`); the Windows build
  failed without `icon.ico`.
- LICENSE, ROADMAP.md, SECURITY.md, CONTRIBUTING.md and this changelog.

### Changed
- **Bots rewritten.** Plex, Jellyfin and Emby are one service with three adapters
  (`server/services/mediaServerBot.js`). IPTV and YouTube are rewritten too, and every bot has a
  small client dialog (`mediabots.js`, `iptv.js`, `youtube.js`) instead of an admin panel.
- **Who can use bots:** admins set them up. Anyone can search and browse. Play and stop need you in
  that voice channel.
- **Stream proxy:** it only accepts links the server issued (an encrypted upstream URL), and passes
  byte ranges through so seeking works.
- **YouTube:** no longer uses `ytdl-core`. It reads title and thumbnail from oEmbed and plays even
  if that fails.
- **Removed:** IPTV "recordings" (they never recorded), the unused image search, Star Citizen, RPG,
  activity stats, emulator and activity-tracking services, and their routes and models.
- Game Together's server side only hands out seats. The virtual-controller backends that never
  drove a device (ViGEm stub, in-memory uinput, foohid, mock) are gone, along with the
  `gameTogether:input` socket event and `POST /api/admin/game-together/input`.
- Docker: the server container no longer gets `/dev/uinput` or `SYS_ADMIN`.
- Windows installer is x64 only (it now carries a native module).
- Android moved to Capacitor 7 (JDK 21, Android SDK 35); the `mobile/android/` project is now
  committed, and cleartext HTTP is allowed for plain-HTTP LAN servers.
- socket.io-client, hls.js and mpegts.js are vendored in `client/public/vendor/` instead of
  loaded from a CDN.
- Renamed from f7lans to **Emberlan**. The MongoDB database (`f7lans`), Docker volume names
  (`f7lans-*`) and browser storage keys are unchanged so existing installs keep their data and
  logins. `EMBERLAN_*` environment variables are read first, `F7LANS_*` as a fallback.
- One UI for every client: the desktop renderer (`electron-client/renderer/`) and the Android web
  assets (`mobile/www/`) are generated from `client/public/` at build time instead of being kept
  as separate copies.
- Android shell restored on the shared UI, with `mobile/native-bridge.js` providing the same
  `window.electronAPI` surface as the desktop preload.
- Docs renamed to lowercase (`docs/architecture.md`, `docs/api.md`, `docs/running.md`, and so on);
  `GAME_TOGETHER.md` moved to `docs/game-together.md`.

### Fixed
- **The stream proxy was open to anyone:** without logging in, anyone could make the server fetch
  any URL, including machines on its LAN.
- **Keys leaked to every client:** Plex tokens, Jellyfin/Emby API keys and IPTV account details
  reached all clients inside stream URLs, channel lists and status.
- **Jellyfin and Emby played audio only:** they requested an audio-only MP3 stream for every item,
  so movies never showed video. Video now plays as HLS.
- **Emby fetched items** from an endpoint Emby doesn't have. Jellyfin accepted a wrong API key as
  "connected".
- **Bots were unusable for non-admins:** every bot dialog called admin-only routes, so regular
  users saw "forbidden".
- **IPTV guessed formats wrong:** it rewrote every stream URL to `.m3u8`, which broke HLS without
  that extension, raw MPEG-TS, and URLs with tokens. The server now probes the stream.
- **The IPTV playlist parser** dropped attributes that weren't in one fixed order. The guide
  ignored timezones.
- **Plex thumbnails always failed** (a relative URL passed to node-fetch).
- **Settings:** disconnecting a media server wasn't saved, so a restart reconnected it. YouTube
  forgot it was turned on after every restart.
- **Late joiners** got Plex/Jellyfin/Emby sessions without a thumbnail or format.
- **Anyone could stop anyone's stream:** any user could stop any IPTV stream, or all of them at
  once.
- **Ghost voice members:** after a restart, the database still listed voice members from before,
  and new callers tried to call those ghosts. Voice membership is now cleared at startup.
- **hls.js and mpegts.js workers** were blocked by the web client's security policy. Playback fell
  back to the main thread and logged errors.
- Touch pad: the X button was never shown, because it shared the CSS class `tp-x` with the
  edit-mode hide control. The harness now checks every control is visible.
- Toasts no longer cover the touch pad during a game; one sat on the A button and swallowed presses.
- Game Together events went to a Socket.IO room nobody was in (`<channelId>` instead of
  `voice:<channelId>`), so nobody heard about sessions.
- The UI read `state.user._id` but login returns `id`, so your own DMs showed as the other
  person's and the Play Together button showed on your own screen share. User objects now carry both.
- Screen share and camera status updates on the server never ran (Mongoose queries are lazy).
- The harness picked random ports that could land in Windows-reserved ranges; it now asks the OS.
- Repository renamed to `sp00nznet/emberlan`.
- CORS only allowed `CLIENT_URL` and two localhost origins, so the desktop app (`Origin: null`)
  and Android (`https://emberlan.local`) could not call the API. REST and socket.io now allow any
  origin; auth is a Bearer token, never a cookie.
- Federated server sockets had the same connect race as user sockets (handlers registered
  after an `await`).
- The helmet Content Security Policy blocked the CDN scripts and all inline `onclick` handlers in
  the server-served web UI, leaving it with no socket and dead buttons. The CSP is now set
  explicitly in `server/index.js`.
- A duplicate `loadChannels()` in `app.js` shadowed the real one, so after login no channel opened
  and DMs never loaded. Duplicate `getRoleColor` and `leaveGameTogether` removed too.
- Socket connect race: the server registered its socket handlers after an `await`, so a
  `channel:join` sent right after connecting was dropped and chat messages never arrived.
- Five client calls used relative `/api/` URLs, which have no origin on desktop and Android.
- Game Together input event renamed from `game-together:input` to `gameTogether:input` to match
  the server.

### Removed
- macOS and Linux desktop build targets, and the iOS target.
- `harmony-discord-clone.html` and a committed upload file.
- `docs/PROJECT_STATUS.md` (stale; current status lives in the README and ROADMAP.md).

## [1.0.0] - 2026-05-29

First version, published as f7lans. Summarized from the git history; no changelog was kept then.

### Added
- Node.js/Express/Socket.IO server with MongoDB: accounts, JWT sessions, text channels,
  messages, reactions, invites, admin panel, groups with role-based access control, and a
  moderator role.
- Two-factor authentication (TOTP), social account linking, Steam integration, activity tracking.
- Google OAuth sign-in with web session persistence.
- End-to-end encrypted direct messages and channel management.
- Server federation (HMAC-signed server-to-server links, channel and message sync) with a UI.
- Media bots: YouTube, Plex, Emby, Jellyfin, IPTV, Twitch and a shared Chrome browser, with a
  stream proxy, persisted bot settings and per-channel bot controls.
- Game Together: virtual controllers for local multiplayer games (replaced the earlier
  per-emulator bots).
- Electron desktop client with screen sharing, device settings and an embedded-server mode.
- Docker Compose setup, Windows and Debian setup and build scripts, a containerized web client,
  and a GitLab CI pipeline building the server image and Windows clients.

### Fixed
- OAuth `redirect_uri` mismatches behind a reverse proxy (trust proxy, configured public URL).
- The users validator no longer requires a password (OAuth accounts have none).
- Docker startup reliability and health check.

### Removed
- Emulator-specific bots, file sharing and the Star Citizen bot.

[Unreleased]: https://github.com/sp00nznet/emberlan/compare/4397046...HEAD
[1.0.0]: https://github.com/sp00nznet/emberlan/commit/4397046
