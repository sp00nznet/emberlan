# Roadmap

Current state is in the [README](README.md#status). This file is intent, not fact.

## Next

1. **Play Game Together with a real driver and game.** The harness proves the pipeline with a
   stand-in for ViGEmBus; play an actual local-multiplayer game on a Windows PC with ViGEmBus,
   with guests on a phone and a desktop, and note the latency.
2. **TURN for voice behind strict NAT.** Voice is STUN-only; add a TURN server (coturn) setting
   and pass it to `ICE_SERVERS` in `client/public/voice-rtc.js`.
3. **Signed Android release builds.** The release workflow attaches a debug APK; a release-signed
   APK needs a keystore stored as a repository secret.
4. **Tighten the CSP:** move the UI's ~190 inline `onclick` handlers to `addEventListener`, then
   drop `script-src-attr 'unsafe-inline'` from `server/index.js`.
5. **Tag v1.1.0** so the release workflow publishes the first Windows installer and APK.
6. A working change-password form in Settings > Account. The server endpoint
   `PUT /api/auth/password` exists; the button only shows a toast.

- **Voice panel member count**: the admin's panel showed "In voice — 0" with two people in the call
  (seen in `docs/screenshots/desktop-bots-playing.png`).
- **Chrome bot** is a framed web page, not a shared browser; most sites refuse framing. Decide
  whether to make it a real shared browser (headless Chromium streamed over WebRTC) or retire it.
- **Twitch bot** is broken (client sends `streamer`, server reads `username`) and can't embed in
  the desktop or Android app (Twitch needs a real hostname as `parent`). Low priority.
- **Channel history can overwrite a just-sent message.** `loadMessages` replaces the list when
  its fetch returns, so a message that arrives over the socket first disappears until reload.
  Merge instead of replace. (The harness waits for history to dodge it; a real user rarely hits it.)

## Deferred

- An SFU (mediasoup, LiveKit) for voice rooms larger than about 8 people; the mesh sends one
  copy of each stream to every listener.

Nothing beyond the list above.

## Out of scope

- macOS desktop app
- Linux desktop app (the server still runs on Linux)
- iOS app
