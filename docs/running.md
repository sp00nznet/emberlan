# Running a server

Deploy, configure, back up, restore and upgrade an Emberlan server. First-time install is in the
[README](../README.md#getting-started).

## Deploy

### Docker Compose (recommended)

```bash
cp .env.example .env        # then set JWT_SECRET and MONGO_ROOT_PASSWORD
docker-compose up -d --build
docker-compose ps
curl http://localhost:3001/health
```

`scripts\quickstart.bat` (Windows) and `scripts/docker-start.sh` (Linux) wrap the same
`up -d --build`. Services in `docker-compose.yml`:

| Service | Port | Notes |
|---|---|---|
| `mongodb` | internal | `mongo:7`, database `f7lans`, volume `f7lans-mongodb-data` |
| `server` | `${SERVER_PORT:-3001}` | serves the API, Socket.IO and the web UI; uploads in volume `f7lans-uploads` |
| `webclient` | `${WEBCLIENT_PORT:-3000}` | profile `with-webclient`; nginx serving the UI separately. Not needed, since `server` already serves it |
| `nginx` | 80, 443 | profile `with-nginx`; reverse proxy using `docker/nginx.conf` (HTTPS block commented out, see HTTPS below) |

Enable a profile with `docker-compose --profile with-nginx up -d`.

Game Together needs nothing from the server container: virtual controllers are created by the
host's desktop app ([game-together.md](game-together.md)).

### Plain Node

```bash
npm install
cp .env.example .env
npm start            # or: npm run dev  (nodemon, restarts on change)
```

Needs MongoDB reachable at `MONGODB_URI`. The server makes five connection attempts five seconds
apart, then exits with `All MongoDB connection attempts failed. Exiting.` Run it under a process
manager (systemd, PM2, NSSM on Windows) to restart it on crash.

### Embedded in the desktop app

`npm run electron:embedded` (or the desktop app started with `--embedded-server`) runs the server
inside Electron and points the UI at it; `npm run electron:headless` runs only the server with a
tray icon. It still needs a MongoDB.

## Configure

Settings are environment variables, read from `.env` in the repo root (or the Compose
`environment:` block).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `MONGODB_URI` | `mongodb://localhost:27017/f7lans` | MongoDB connection string |
| `JWT_SECRET` | a public built-in string | **Set this.** Signs session tokens |
| `CLIENT_URL` | `http://localhost:3000` | Allowed CORS origin, base for invite links and OAuth redirects |
| `ENABLE_HTTPS` | `false` | Serve HTTPS directly using `./ssl/key.pem` and `./ssl/cert.pem` (relative to the working directory) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | unset | Email invites |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Google sign-in (`OAUTH_GOOGLE_*` also accepted) |
| `GOOGLE_CALLBACK_URL` | `/api/auth/google/callback` | OAuth callback path |
| `OAUTH_PUBLIC_URL` | `CLIENT_URL` | Public base URL used to build the OAuth `redirect_uri` behind a proxy |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | unset | Twitch bot |
| `FEDERATION_ENABLED` | `false` | Turn on federation |
| `FEDERATION_SERVER_NAME` | | Name shown to other servers |
| `SERVER_URL` | `CLIENT_URL` | This server's public URL for federation |
| `WS_URL` | derived from `SERVER_URL` | Socket URL for federation |
| `FEDERATION_MAX_SERVERS`, `FEDERATION_AUTO_ACCEPT`, `FEDERATION_SYNC_*`, `FEDERATION_HEARTBEAT_INTERVAL`, `FEDERATION_CONNECTION_TIMEOUT`, `FEDERATION_RELAY_BATCH_SIZE` | see `server/config/federation.js` | Federation tuning |

Compose-only: `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD` (defaults `f7admin` / `f7password`,
change them), `SERVER_PORT`, `WEBCLIENT_PORT`, `NGINX_HTTP_PORT`, `NGINX_HTTPS_PORT`.

Desktop app variables use the `EMBERLAN_` prefix (`EMBERLAN_EMBEDDED_SERVER`,
`EMBERLAN_HEADLESS`, ...); the old `F7LANS_` names still work.

### HTTPS

Either put a reverse proxy in front (Caddy or your own nginx; it must pass
`Upgrade`/`Connection` headers for Socket.IO), or set `ENABLE_HTTPS=true` and place
`key.pem`/`cert.pem` in `ssl/` under the server's working directory.

The bundled `with-nginx` profile listens on port 80 only as shipped: the `listen 443` server block
in `docker/nginx.conf` is commented out. Uncomment it and put certificates in `docker/ssl/`;
`scripts\generate-ssl.bat` writes a self-signed pair there with OpenSSL.

### First login

The first start creates `admin` / `admin123`. Change it right away with
`PUT /api/auth/password` (see the README); the Settings form for it does not work yet.

## Back up

Windows: `scripts\backup-database.bat`. If the `emberlan-mongodb` container is running it runs
`mongodump --db f7lans` inside it and copies the dump out; otherwise it runs a local `mongodump`.

Linux / by hand:

```bash
docker exec emberlan-mongodb mongodump --db f7lans --out /tmp/backup
docker cp emberlan-mongodb:/tmp/backup/f7lans ./backups/f7lans-$(date +%F)
```

If you changed `MONGO_ROOT_USER`/`MONGO_ROOT_PASSWORD`, add
`-u <user> -p <password> --authenticationDatabase admin`.
Uploaded files (avatars, attachments) are in the `f7lans-uploads` volume or `server/uploads/`;
back them up separately.

## Restore

Windows: `scripts\restore-database.bat` (runs `mongorestore --db f7lans --drop`, in the container
when it is running).

By hand:

```bash
docker cp ./backups/f7lans-2026-10-29 emberlan-mongodb:/tmp/restore
docker exec emberlan-mongodb mongorestore --db f7lans --drop /tmp/restore
```

`--drop` replaces existing collections.

## Upgrade

```bash
git pull
docker-compose up -d --build     # or: npm install && restart the server
```

Back up first. The database name and volume names did not change in the f7lans to Emberlan
rename, so an existing install keeps its data. There are no migrations; Mongoose models add new
fields with defaults on read.

## Troubleshooting

- **Port in use:** set `PORT` (plain Node) or `SERVER_PORT` (Compose).
- **Server exits right after start:** MongoDB is not reachable at `MONGODB_URI`.
- **Google sign-in `redirect_uri_mismatch`:** set `OAUTH_PUBLIC_URL` to the URL users reach the
  server at, and register `<that URL>/api/auth/google/callback` with Google.
- **Logs:** `docker-compose logs -f server`, or `scripts\docker-logs.bat`.
