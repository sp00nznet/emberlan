# Security

Emberlan stores credentials and private messages, so treat a server as sensitive.

## What it handles

- **Passwords:** hashed with bcrypt before storage.
- **Sessions:** JWTs signed with `JWT_SECRET`, valid for seven days. If `JWT_SECRET` is not set,
  the server falls back to a default string published in this repository
  (`server/middleware/auth.js`), and anyone can forge a token. **Always set `JWT_SECRET`.** The
  default in `docker-compose.yml` is public too.
- **OAuth:** the Google client ID and secret come from the environment (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`). Keep them out of git.
- **Direct messages:** encrypted end to end in the client. The server stores and relays only the
  ciphertext, IV and wrapped key.
- **Federation:** servers authenticate to each other with HMAC-SHA256 signed requests.
- **Third-party keys:** media bot settings (Plex, Emby, Jellyfin, Twitch and others) keep their
  API keys in MongoDB.

## Before exposing a server

1. Log in as `admin` / `admin123` and change the password immediately. The Settings form does
   not work yet, so use `PUT /api/auth/password` as shown in the README.
2. Set a long random `JWT_SECRET`, and change `MONGO_ROOT_PASSWORD` from the Compose default.
3. Serve it over HTTPS (your own reverse proxy, or the `with-nginx` profile after enabling its HTTPS block; see docs/running.md).

## Supported versions

Only the latest commit on `main` gets fixes. There are no tagged releases yet.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private reporting on this repository
(**Security** tab, **Report a vulnerability**) with steps to reproduce and the commit you tested.
Expect a reply within a week.
