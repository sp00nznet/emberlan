# Bots Guide

```
███████╗███████╗██╗      █████╗ ███╗   ██╗███████╗
██╔════╝╚════██║██║     ██╔══██╗████╗  ██║██╔════╝
█████╗      ██╔╝██║     ███████║██╔██╗ ██║███████╗
██╔══╝     ██╔╝ ██║     ██╔══██║██║╚██╗██║╚════██║
██║        ██║  ███████╗██║  ██║██║ ╚████║███████║
╚═╝        ╚═╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝
```

Documentation for the media bots configured in Settings > Media Bots.

---

## Table of Contents

- [Overview](#overview)
- [Media bots](#media-bots)
  - [YouTube](#youtube)
  - [Plex, Jellyfin, Emby](#plex-jellyfin-emby)
  - [IPTV](#iptv)
  - [Twitch Bot](#twitch-bot)
- [Utility Bots](#utility-bots)
  - [Chrome Bot](#chrome-bot)
- [Gaming Features](#gaming-features)
  - [Game Together](#game-together)
- [Per-Channel Bot Settings](#per-channel-bot-settings)
- [Permissions](#permissions)

---

## Overview

Bots play media to everyone in a voice channel. They don't send it over the voice call. When a
bot starts, the server tells everyone in that voice channel (`youtube:playing`, `media:playing`,
`iptv:playing`), and each client plays the stream in its video grid. Someone who joins the
channel later is sent what is playing.

| Category | Bots |
|:---------|:-----|
| **Media** | YouTube, Plex, Jellyfin, Emby, IPTV (all checked end to end by the conformance harness) |
| **Other** | Chrome (a shared web page), Twitch (see their sections), Game Together |

### Who can do what

| Action | Who |
|---|---|
| Turn a bot on or off, connect a media server, load an IPTV playlist | admins |
| See a bot's status, search, browse channels | any logged-in user (status never contains keys) |
| Play or stop in a voice channel | anyone **in that voice channel**, and admins |

Open a bot from **Bots** in the voice panel. Admins see the setup at the top of the same dialog.

### The stream proxy and your keys

Plex tokens, Jellyfin/Emby API keys and IPTV account details live in stream URLs, so they never
reach clients:
- Streams and thumbnails are sent as `/api/stream/proxy?u=<sealed>` links.
- The upstream URL is encrypted inside the link with a key the server makes at startup.
- The proxy only fetches links the server issued, so it can't be used to reach other machines on
  the server's network.
- Byte ranges pass through, so seeking works. HLS playlists are rewritten so their segments,
  keys and variants go through the proxy too.
- Links stop working after a server restart; playing again issues new ones.

---

## Media bots

### YouTube

Paste any YouTube link (watch, youtu.be, Shorts, live, mobile or music links). Everyone in the
voice channel gets the official YouTube player for that video. The server only checks the link
and fetches the title and thumbnail from YouTube's oEmbed endpoint; if that fails, the video still
plays. The desktop app sends a Referer to YouTube embeds, which they need when the page is a local
file.

### Plex, Jellyfin, Emby

**Setup (admin):** enter the server URL and a credential, then **Turn on**.
- **Plex:** a Plex token (`X-Plex-Token`).
- **Jellyfin and Emby:** an API key from the server's dashboard.

A wrong key is rejected when you connect. Settings are saved. If the media server is down when
Emberlan starts, the settings are kept and the bot reconnects on the next search or play.

**Playing:** search, then **Play**. Movies, episodes, music videos and tracks are listed. Shows and
albums are not; search for the episode or track.

| Server | Video | Music |
|---|---|---|
| Plex | the file itself if browsers can play it (mp4, webm), otherwise Plex's HLS transcode | the file |
| Jellyfin, Emby | the server's HLS transcode (H.264 + AAC) | MP3 |

All three share one service, `server/services/mediaServerBot.js`, with a small adapter per
server.

### IPTV

**Setup (admin):** load an M3U playlist from a URL or upload an `.m3u` file. You can also add an
XMLTV guide URL, then **Turn on**.
- `#EXTINF` attributes are read in any order: `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`.
- The guide's times respect their timezone offsets.
- The channel list and guide are saved; the guide is reloaded at startup.

```
#EXTM3U
#EXTINF:-1 tvg-id="news.example" tvg-logo="http://example/logo.png" group-title="News",Example News
http://provider.example/live/user/pass/1.m3u8
```

**Watching:** pick a group, filter by name, then **Watch**. The current program from the guide is
shown.
- **Format detection:** the server checks what the stream is when you press Watch. An HLS playlist
  plays through hls.js whatever its URL looks like; raw MPEG-TS plays through mpegts.js.
- **Dead channels:** a channel that doesn't answer gives an error instead of a black tile.
- **Privacy:** channel URLs, which usually include the provider account, never leave the server.

Recordings were listed in the old UI but never recorded anything, and have been removed.

### Twitch Bot

> **Not working, not covered by the harness.** Starting a stream fails: the client sends `streamer`
> and the server reads `username`. The player also needs the page's hostname, which the desktop and
> Android apps don't have. Low priority; see [ROADMAP.md](../ROADMAP.md).

Watch Twitch streams together with embedded player.

**Admin Setup:**
1. Go to **Settings** → **Administration** → **Media Bots** → **Twitch**
2. Enable the bot
3. Create an app at [dev.twitch.tv/console](https://dev.twitch.tv/console)
4. Enter Client ID and Client Secret

**User Features:**
- Search for live streams
- View stream info (title, game, viewers)
- Embedded Twitch player
- Embedded Twitch chat
- Watch parties for favorite streamers

---

## Utility Bots

### Chrome Bot

> **Not a browser.** It shows a web page in a frame for everyone in the channel. Most sites refuse to
> be framed, and the web client's security policy only allows YouTube and Twitch frames, so in the
> browser it rarely loads anything. Not covered by the harness; see [ROADMAP.md](../ROADMAP.md).

Shared browser sessions for collaborative browsing.

**Admin Setup:**
1. Go to **Settings** → **Administration** → **Media Bots** → **Chrome**
2. Enable the bot

**Requirements:**
- Chromium/Chrome installed on server
- Sufficient server resources for headless browser

**User Features:**
- Start a shared browser session
- Navigate to any URL
- Back/forward navigation
- Refresh page
- Transfer control between users
- Multiple users watch the same session

**Control Transfer:**
- One user has control at a time
- Controller can pass control to anyone in session
- Click "Request Control" to ask current controller

**Use Cases:**
- Watch videos together (YouTube, etc.)
- Collaborative shopping
- Demo websites to the team
- Browse documentation together

---

## Gaming Features

### Game Together

Play a host's local-multiplayer game with people in your voice channel: guests' controllers or
phone touch pads become Xbox controllers on the host's PC. Not a bot that joins the channel; on by
default, and the admin panel here only turns it off and lists sessions. Hosting needs the Windows
desktop app with ViGEmBus installed. Full guide: [game-together.md](game-together.md).

**Use Cases:**
- Couch co-op games over the internet
- Fighting games with friends
- Local-multiplayer party games ([game-together.md](game-together.md))
- Any game with local multiplayer support

---

## Per-Channel Bot Settings

Control which bots are available in each channel.

### How It Works

1. Bots are enabled globally in admin settings
2. Admins can enable/disable bots per channel
3. By default, all bots are enabled in all channels
4. Users can only use bots enabled both globally AND in the channel

### Managing Channel Bots

1. Go to channel settings (gear icon)
2. Navigate to **Bots** tab
3. Toggle individual bots on/off
4. Changes take effect immediately

### Use Cases

| Channel Type | Recommended Bots |
|:-------------|:-----------------|
| Gaming | Game Together |
| Movies | YouTube, Plex, Emby, Jellyfin |
| Watch Party | YouTube, Twitch |
| Browsing | Chrome |
| General | All disabled or limited |

---

## Permissions

Bot access is controlled through the Groups & Permissions system.

### Available Bot Permissions

| Permission | Bot |
|:-----------|:----|
| `youtube-bot` | YouTube |
| `plex-bot` | Plex |
| `emby-bot` | Emby |
| `jellyfin-bot` | Jellyfin |
| `iptv-bot` | IPTV |
| `twitch-bot` | Twitch |
| `chrome-bot` | Chrome |
| `game-together` | Game Together |

### Granting Permissions

1. Go to **Settings** → **Administration** → **Groups**
2. Create or edit a group
3. Enable bot permissions for that group
4. Add users to the group

### Default Groups

| Group | Bot Access |
|:------|:-----------|
| Everyone | None (base permissions only) |
| Admins | All bots |

---

## API Endpoints

All bots expose REST API endpoints for programmatic control. See [API Reference](api.md) for full documentation.

Common patterns:
- `GET /api/admin/{bot}-bot/status` — Get bot status
- `POST /api/admin/{bot}-bot/enable` — Enable/disable bot
- `POST /api/admin/{bot}-bot/play` — Start playback
- `POST /api/admin/{bot}-bot/stop` — Stop playback

---

## Troubleshooting

### Bot Won't Enable

1. Check admin settings — is the bot enabled globally?
2. Check user permissions — does the user have bot permission?
3. Check channel settings — is the bot enabled for this channel?

### Streaming Issues

- **"Could not reach Plex/Jellyfin/Emby"**: the Emberlan server can't reach the media server URL.
  It is the Emberlan server that connects, not your browser.
- **"<channel> is not reachable"** (IPTV): the provider refused or timed out; check the account.
- **A tile stays black**: open the browser console. HLS errors are logged as `[bot stream]`.

---

Have questions? [Open an issue](https://github.com/sp00nznet/emberlan/issues)!
