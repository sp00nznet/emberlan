# Development

How the code is laid out and how to work on it. Read [architecture.md](architecture.md) first.

## Setup

```bash
npm install                      # server + harness dependencies
cp .env.example .env
npm run dev                      # nodemon on server/index.js; needs MongoDB at MONGODB_URI
```

No MongoDB installed? `docker run -d -p 27017:27017 --name emberlan-dev-mongo mongo:7`.

The web UI is at <http://localhost:3001>. It is plain HTML, CSS and JavaScript with no build
step: edit `client/public/` and reload the page.

Desktop: `cd electron-client && npm install && npm start` (copies the UI into `renderer/` first).
Android: see "Building from source" in the [README](../README.md#building-from-source).

## Layout

```
server/
  index.js              Express app, Socket.IO setup, default admin/channels, /health
  routes/api.js         every REST route
  socket/socketHandler.js  every Socket.IO event
  controllers/          request handlers, one file per area
  services/             bots, federation, groups, activity
  models/               Mongoose schemas
  middleware/           auth (JWT), access control
  config/               database connection, federation settings
client/public/          the UI for all three clients (index.html, app.js, styles.css, logo.svg)
electron-client/        Windows desktop shell: main.js, preload.js, scripts/copy-*.js
mobile/                 Android shell: native-bridge.js, capacitor.config.json, scripts/copy-client.js
conformance/            conformance harness (see conformance.md)
docker/                 Dockerfiles, nginx config, mongo init
scripts/                Windows .bat and Debian .sh helpers
design_ref/             Ember design handoff (spec and mockups)
```

`electron-client/renderer/` and `mobile/www/` are generated. Do not edit them.

## Rules that keep the clients at parity

- Build every request URL from `state.serverUrl`; a relative `/api/` URL breaks desktop and
  Android.
- A new `window.electronAPI` function goes into both `electron-client/preload.js` and
  `mobile/native-bridge.js` (stub it on Android if it has no meaning there).
- Register Socket.IO handlers synchronously on connect; anything awaited before `socket.on`
  drops early client events.
- No CDN scripts in the UI: the CSP blocks them and the shells must work offline.

## Testing

There is no unit test suite. The conformance harness is the test:

```bash
node conformance/run.js --static   # fast, no database
node conformance/run.js            # also boots the server on an in-memory MongoDB
```

See [conformance.md](conformance.md) for adding a check.

## Debugging

- Server: `node --inspect server/index.js`, then attach from `chrome://inspect`.
- Socket.IO: `DEBUG=socket.io* npm start`; in the browser console,
  `localStorage.debug = 'socket.io-client:*'`.
- Desktop: start with `NODE_ENV=development` and DevTools opens with the window (default Electron menu also has Toggle Developer Tools, Ctrl+Shift+I).
- MongoDB: `mongosh mongodb://localhost:27017/f7lans`.
