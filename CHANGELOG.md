# Changelog

All notable changes to Emberlan are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
