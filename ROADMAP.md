# Roadmap

Current state is in the [README](README.md#status). This file is intent, not fact.

## Next

1. **TURN for voice behind strict NAT.** Voice is STUN-only; add a TURN server (coturn) setting
   and pass it to `ICE_SERVERS` in `client/public/voice-rtc.js`.
2. **Signed Android release builds.** The release workflow attaches a debug APK; a release-signed
   APK needs a keystore stored as a repository secret.
3. **Tighten the CSP:** move the UI's ~190 inline `onclick` handlers to `addEventListener`, then
   drop `script-src-attr 'unsafe-inline'` from `server/index.js`.
4. **Tag v1.1.0** so the release workflow publishes the first Windows installer and APK.
5. A working change-password form in Settings > Account. The server endpoint
   `PUT /api/auth/password` exists; the button only shows a toast.

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
