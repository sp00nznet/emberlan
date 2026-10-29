# Roadmap

Current state is in the [README](README.md#status). This file is intent, not fact.

## Next

1. **WebRTC media for voice, video and screen share.** The server already relays
   `webrtc:offer`, `webrtc:answer` and `webrtc:ice-candidate`; the client needs to create peer
   connections, send and handle those events, and attach the streams. Done when the three
   `contract/webrtc` conformance checks pass and two clients hear each other.
2. **Signed Android release builds.** The release workflow attaches a debug APK; a release-signed
   APK needs a keystore stored as a repository secret.
3. **Tighten the CSP:** move the UI's ~190 inline `onclick` handlers to `addEventListener`, then
   drop `script-src-attr 'unsafe-inline'` from `server/index.js`.
4. **Tag v1.1.0** so the release workflow publishes the first Windows installer and APK.
5. **Rename the GitHub repository** from `sp00nznet/f7lans` to Emberlan and update the links.
6. A working change-password form in Settings > Account. The server endpoint
   `PUT /api/auth/password` exists; the button only shows a toast.

- **Channel history can overwrite a just-sent message.** `loadMessages` replaces the list when
  its fetch returns, so a message that arrives over the socket first disappears until reload.
  Merge instead of replace. (The harness waits for history to dodge it; a real user rarely hits it.)

## Deferred

Nothing beyond the list above.

## Out of scope

- macOS desktop app
- Linux desktop app (the server still runs on Linux)
- iOS app
