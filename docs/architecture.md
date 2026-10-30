# Architecture

Emberlan is one server and one UI. The UI runs in three shells: a browser, the Windows desktop
app and the Android app.

```
                     ┌──────────────── client/public/ (the only UI source) ────────────────┐
                     │ index.html · app.js · touchpad.js · styles.css · vendor/ (no build)    │
                     └───────┬──────────────────────────┬──────────────────────────┬────────┘
              served as-is   │     copied at build time │      copied at build time │
                             ▼                          ▼                           ▼
                        Browser               electron-client/renderer/       mobile/www/
                    (same origin)            + preload.js (window.electronAPI) + native-bridge.js
                             │                          │                           │
                             └────────── HTTP /api/* + Socket.IO ──────────────────┘
                                                        ▼
                                      server/ (Node.js, Express, Socket.IO)
                                                        ▼
                                              MongoDB (database `f7lans`)
                                                        ▲
                                     other Emberlan servers (federation, HTTP + Socket.IO)
```

## The parts

| Part | Owns | Code |
|---|---|---|
| Server | REST API, Socket.IO events, auth, bots, federation; serves `client/public` at `/` and uploads at `/uploads` | `server/index.js`, `server/routes/api.js` (all routes in one file), `server/socket/socketHandler.js`, `server/controllers/`, `server/services/`, `server/models/` |
| UI | Everything the user sees, in every client | `client/public/` |
| Windows desktop | Window, tray, push-to-talk hotkeys, screen source picker, token and settings storage, optional embedded server | `electron-client/main.js`, `electron-client/preload.js` |
| Android | Capacitor 7 WebView shell, storage via `localStorage` | `mobile/native-bridge.js`, `mobile/capacitor.config.json`, `mobile/android/` (Gradle project, committed) |
| Conformance | Checks the parts above agree | `conformance/run.js`, [conformance.md](conformance.md) |

## One UI, three shells

The UI was once kept as separate copies per client, and they drifted (the desktop copy grew bots
and an auth flow the web lacked). Now there is one copy and the shells are generated:

- **Web:** the server serves `client/public/` directly (`express.static` in `server/index.js`).
- **Desktop:** `electron-client/scripts/copy-renderer.js` copies all of `client/public/` into
  `electron-client/renderer/`. It runs before `npm start` and
  every `build*` script. `renderer/` is in `.gitignore`; `main.js` loads
  `renderer/index.html`.
- **Android:** `mobile/scripts/copy-client.js` empties `mobile/www/`, copies `client/public/`
  into it, adds `native-bridge.js`, and inserts `<script>` tags for `capacitor.js` and
  `native-bridge.js` before `app.js`.

Platform differences go through `window.electronAPI`. `app.js` checks for it and falls back to
browser behavior when it is absent. The desktop preload and the Android bridge expose the same
keys (`getSettings`, `saveSettings`, `saveToken`, `getToken`, `clearToken`, `setServerUrl`,
`showNotification`, `flashWindow`, `updateTrayStatus`, `onToggleMute`, `onToggleDeafen`,
`onPTTStart`, `onPTTEnd`, `onOpenSettings`, `getScreenSources`, `selectFolder`, `platform`,
`version`); Android stubs the ones it cannot do (tray, hotkeys, screen sources). The conformance
harness fails if a key the UI uses is missing from either shell.

The UI is plain JavaScript with no framework or build step. Its libraries (socket.io-client,
hls.js, mpegts.js) are vendored in `client/public/vendor/` because the CSP in `server/index.js`
allows scripts only from `'self'` and the desktop and Android shells must work offline. The CSP
still allows inline `onclick` attributes (`script-src-attr 'unsafe-inline'`) until the handlers
move to `addEventListener` (ROADMAP).

Desktop and Android have no same origin, so every request is built from `state.serverUrl`
(`${state.serverUrl}/api/...`), never a relative `/api/` path.

## Data flow

- **REST** (`/api/*`, JWT in `Authorization: Bearer`) for accounts, channel lists, history,
  settings, bots, federation admin. Routes: [api.md](api.md).
- **Socket.IO** for live traffic. The client connects with `auth: { token }`. The server joins
  each socket to `user:<id>`, and to `channel:<id>` or `voice:<id>` rooms on `channel:join` /
  `voice:join`. Events the server handles: `channel:join|leave`, `message:send|edit|delete|reaction`,
  `typing:start|stop`, `dm:send|read|setPublicKey|getPublicKey`, `voice:join|leave|mute|deafen`,
  `camera:toggle`, `screen:start|stop`, `status:update|custom`, `gameTogether:input`,
  `webrtc:offer|answer|ice-candidate`, and the `federation:*` events.
- **Handlers are registered synchronously on connect.** They used to be registered after an
  `await`, which dropped a `channel:join` sent immediately after connecting.
- **DMs** are encrypted in the client; the server stores `encryptedContent`, `iv` and
  `encryptedKey` (`server/models/DirectMessage.js`) and relays them to `user:<recipient>`.
- **Voice/video:** the server tracks voice room membership and relays WebRTC signaling between
  peers (`webrtc:offer|answer|ice-candidate`, plus a `meta` map that says which stream is a camera
  and which a screen share). Media goes peer to peer, never through the server:
  `client/public/voice-rtc.js` keeps one `RTCPeerConnection` per other user in the channel (a
  full mesh) and uses the "perfect negotiation" pattern, so cameras and screen shares can be added
  or removed at any time by either side without signaling races. Joining a channel connects to
  everyone in `voice:currentUsers`; `voice:userLeft` closes that peer. STUN only, no TURN; a
  mesh suits about 8 people, larger rooms would need an SFU.
- **Federation:** servers link over HTTP and Socket.IO with HMAC-SHA256 signed requests
  (`server/config/federation.js`, `server/services/federationService.js`). See
  [federation.md](federation.md).

## Deployment shapes

- **Docker Compose** (`docker-compose.yml`): `mongodb` (mongo:7) and `server` (port 3001). The
  `with-webclient` profile adds an nginx-served copy of the UI on port 3000; the `with-nginx`
  profile adds an HTTPS reverse proxy on 80/443.
- **Plain Node:** `npm start` against any MongoDB.
- **Embedded:** the desktop app with `--embedded-server` starts the server inside Electron
  (`electron-client/main.js`); `build:win:unified` bundles it via `scripts/copy-server.js`.

Running, configuration and backups: [running.md](running.md).
