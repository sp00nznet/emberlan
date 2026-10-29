# Features

What Emberlan does today, split into what the UI exposes and what exists only as a server API.
Endpoints are in [api.md](api.md); intent is in [ROADMAP.md](../ROADMAP.md).

## In the UI (web, Windows desktop, Android)

**Accounts**
- Register and log in with a username and password, or sign in with Google (when
  `GOOGLE_CLIENT_ID` is set). Sessions are JWTs and persist across restarts.
- Profile editing (`PUT /api/auth/profile`). Changing your password is **not** wired up: the
  Settings > Account button only shows a toast; the API endpoint `PUT /api/auth/password` works.
- Multiple saved servers on the login screen; desktop and Android let you edit the server address.

**Text chat**
- Text channels with history, live delivery over Socket.IO, and file attachments
  (`/api/attachments/upload`). Edits and deletions made elsewhere show up live
  (`message:updated`, `message:deleted`), but the UI cannot edit, delete or react itself, and it
  sends no typing events; the server handles `message:edit|delete|reaction` and `typing:*`.
- IRC-style layout: `[time] nick body`, `@` for operators and `+` for voiced users, colored nicks.
- Members panel grouped Ops / Voiced / Online / Offline.

**Direct messages**
- One-to-one DMs encrypted in the client. Each user publishes a public key
  (`dm:setPublicKey`); messages are sent as ciphertext plus IV and wrapped key, so the server and
  its admins cannot read them.

**Voice, video, screen share**
- Joining a voice channel shows you in it to everyone else; mute, deafen, camera and screen-share
  toggles send that state to the server (`voice:mute`, `voice:deafen`, `camera:toggle`,
  `screen:start|stop`). The UI listens only for users joining and leaving, so others do not see
  mute or camera changes.
- The client captures the microphone, camera and screen locally (`getUserMedia`,
  `getDisplayMedia`, or the Electron source picker on desktop), and the settings have mic and
  camera tests.
- **No audio or video reaches other users yet.** The client does not do WebRTC signaling. See the
  README Status.
- Touch devices: on-screen gamepad for Game Together ([game-together.md](game-together.md)).
- Desktop only: push-to-talk and mute/deafen hotkeys, system tray, taskbar flashing. Android has no
  screen-source picker.

**Appearance**
- Themes: Ember Dark (default), Midnight, AMOLED.

**Administration** (admin and moderator roles)
- Settings panels: Account, Profile, Voice & Video, Notifications, Appearance, Media Bots,
  Groups & Roles, Federation, Channels, Server.
- User management (create users, roles), channel management, email invites (needs SMTP), groups
  with per-feature permissions.
- Media bots, configured in Settings > Media Bots: YouTube, Plex, Emby, Jellyfin, IPTV, Twitch and
  a shared Chrome browser, plus Game Together. Details in [bots.md](bots.md) and
  [game-together.md](game-together.md). Bot video plays through the server's stream proxy
  (`/api/stream/proxy`); there is no WebRTC media for it either.
- Federation: view this server's info, request and approve links to other servers, analyze
  channel conflicts. See [federation.md](federation.md).

## Server API only (no UI)

These have routes and controllers in `server/` but nothing in `client/public` calls them:

- Two-factor authentication (TOTP, backup codes): `/api/auth/2fa/*`
- Steam account linking and profile: `/api/steam/*`
- Social account linking (Xbox, PlayStation, Blizzard, Reddit, Twitter): `/api/social/*`
- Friend requests: `/api/users/:userId/friend-*`
- Activity tracking and stats: `/api/activity/*`
- Server icon upload: `/api/settings/icon`
- File sharing: `/api/file-share/*` (removed from the UI in January 2026)
- Image search and Star Citizen bots: `/api/admin/image-bot/*`, `/api/admin/sc-bot/*` (removed from
  the UI)

Use them with a token from `/api/auth/login`, or treat them as candidates for removal.

## Clients

| Client | How you get it | Notes |
|---|---|---|
| Web | The server serves it at `/` | Any current Chromium or Firefox |
| Windows desktop | Build with `npm run build:win` in `electron-client/` | NSIS installer (x64, ia32) and portable x64 `.exe`; optional embedded server |
| Android | Build with `npm run build:android` in `mobile/` | Capacitor 7 WebView; debug APK |

macOS, Linux desktop and iOS clients are not built.
