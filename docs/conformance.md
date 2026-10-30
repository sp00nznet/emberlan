# Conformance harness

`conformance/run.js` checks that the UI, the server and the two native shells agree, and that
the real server and the real UI do what users expect. CI runs it on every push and pull request
to `main` (`.github/workflows/ci.yml`). It prints one `PASS` or `FAIL` line per check and a
total, and fails on regression against a committed baseline.

## Running it

```bash
npm install                        # pulls mongodb-memory-server (devDependency)
node conformance/run.js            # contract + live, compare to baseline
node conformance/run.js --static   # contract only; no MongoDB, runs in about a second
node conformance/run.js --accept   # run, then write the baseline, a history row and the README line
node conformance/run.js --screenshots   # also save docs/screenshots/desktop-chat.png and android-touchpad.png
```

Current figure: 218/218.

Real tail of a `--static` run (2026-10-29, while this doc was missing):

```
PASS repo/docs/running.md
FAIL repo/docs/conformance.md - missing

conformance: 151/155 passing
```

## The corpora

**Contract** (static; reads source files, starts nothing):

| Prefix | Checks |
|---|---|
| `contract/api` | Every `/api/...` URL in `client/public/app.js`, with its HTTP method, matches a `router.<method>(...)` in `server/routes/api.js`. One extra check fails if any `fetch()` uses a relative `/api/` URL, because desktop and Android have no same origin. |
| `contract/socket` | Every event the client emits has a `socket.on` in `server/socket/socketHandler.js`; every event the client listens for is emitted somewhere in `server/`. |
| `contract/webrtc` | The client both sends and handles `webrtc:offer`, `webrtc:answer` and `webrtc:ice-candidate`. (The `ui/voice` and `ui/video` checks prove media actually flows.) |
| `contract/no function is defined twice` | Fails on duplicate function names in `app.js`; a later definition silently wins (a duplicate `loadChannels()` once stopped channels and DMs loading). |
| `contract/UI loads no scripts from a CDN` | The UI must work offline in the desktop and Android shells, and the CSP blocks CDN scripts. |
| `parity/bridge` | Every `electronAPI.<fn>` the UI uses exists in both `electron-client/preload.js` and `mobile/native-bridge.js`. |
| `parity/...generated` | The desktop renderer and Android `www/` are copied from `client/public`, `renderer/` is gitignored, and Electron loads `renderer/index.html`. |
| `style/` | No Discord brand colors, fonts or names in the UI. |
| `build/` | Files electron-builder needs (`icon.ico`, `icon.png`). |
| `repo/` | The files REPO_RULES requires (README, LICENSE, CHANGELOG, ROADMAP, SECURITY, CONTRIBUTING, `docs/architecture.md`, `docs/api.md`, `docs/running.md`, this file). |

**Live** (boots `server/index.js` as a child process on a random port):

server boots and `/health` answers; `/` serves the web client; login as the default admin;
register two users; `/api/auth/me`; default text and voice channels exist; both users connect
over Socket.IO; a chat message reaches the other user and is stored; an encrypted DM payload
reaches the recipient; `voice:join` announces the user; and every GET the client makes (ids filled
in where it can) gets a real handler, meaning not Express's bare 404 and not a 500. A JSON 404 or
a 503 "not configured" counts as working.

**UI** (needs Chrome or Edge; set `CHROME_PATH` if it is not found, otherwise it prints
`SKIP ui`): loads the server-served UI in headless Chrome over the DevTools protocol and checks the
login screen renders, the vendored libraries load, logging in through the form connects the socket,
a text channel opens, a message typed in the chat box is stored and shown, the Game Together touch
pad shows every control with no controller connected, two simultaneous touches press A and move the
left stick, layout edits are saved, and no JavaScript error was thrown.

In a second tab a second user joins voice and the corpus checks a real WebRTC call: connection,
audio both ways, deafen, camera on and off, leaving. Then Game Together end to end:
- The first tab hosts. It stands in for the desktop app by recording what would go to ViGEmBus, and
  shares a canvas test game as its screen.
- The second tab, emulating a phone, joins as Player 2 and sees the game in its play view.
- Its touches arrive at the host as Player 2's A button and stick.
- A connected controller takes over from the touch pad.
- Leaving frees the virtual pad, and the host ending the session closes the play view.

The contract corpus checks the desktop's input-to-Xbox-pad mapping (`electron-client/gamepads.js`)
against a stand-in for ViGEmBus, and that a missing driver is reported instead of crashing. This corpus exists because the static
and live checks passed while the real page had a CSP that blocked every script and button.

## Why mongodb-memory-server

The live corpus needs a real MongoDB so Mongoose queries, indexes and the default-admin and
default-channel seeding run exactly as in production. `mongodb-memory-server` downloads a MongoDB
binary once (cached under `node_modules/.cache`), starts it on a free port and throws it away
afterward, so the run needs no Docker, no installed MongoDB and never touches a real database.
If the package is not installed, the live corpus prints `SKIP live` and only the contract corpus
counts.

## Baseline and regressions

- `conformance/results.json` maps each check id to `true`/`false`. A check that is `true` there,
  ran this time and failed is a **regression**: the run lists it and exits 1.
- New checks and checks that were already failing never cause exit 1, so a known gap
  does not block work while it stays visible in the total.
- `--accept` rewrites the baseline, appends `date,commit,pass,total` to `conformance/history.csv`
  and replaces the README text between `<!-- conformance -->` and `<!-- /conformance -->`.
  Accept from a full run, not `--static`, or the baseline loses the live checks.
- Neither file is committed yet; until the first `--accept`, nothing counts as a regression.

## Adding a check

Call `check(id, fn)` inside `contract()` or `live()`. `fn` returns `true` (or nothing) to pass, or
a string or object describing the failure; a thrown error is a failure with its message. Use the
existing prefixes so the groups stay readable, keep ids stable (renaming one drops it from the
baseline), then run a full `--accept` and commit `results.json`, `history.csv` and the README.
