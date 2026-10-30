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
- [Streaming Bots](#streaming-bots)
  - [YouTube Bot](#youtube-bot)
  - [Plex Bot](#plex-bot)
  - [Emby Bot](#emby-bot)
  - [Jellyfin Bot](#jellyfin-bot)
  - [IPTV Bot](#iptv-bot)
  - [Twitch Bot](#twitch-bot)
- [Utility Bots](#utility-bots)
  - [Chrome Bot](#chrome-bot)
- [Gaming Features](#gaming-features)
  - [Game Together](#game-together)
- [Per-Channel Bot Settings](#per-channel-bot-settings)
- [Permissions](#permissions)

---

## Overview

Settings > Media Bots configures these bots. The server also has routes for an image search bot and a Star Citizen bot that the UI no longer exposes.

Bots do not send media over the voice call. When a bot starts playing, the
server tells everyone in the channel (`youtube:playing`, `media:playing`, `iptv:playing`,
`twitch:started`) and each client opens the stream itself in the video grid, directly or through
the server's `/api/stream/proxy`.

| Category | Bots | Count |
|:---------|:-----|:-----:|
| **Streaming** | YouTube, Plex, Emby, Jellyfin, IPTV, Twitch | 6 |
| **Utility** | Chrome | 1 |
| **Gaming** | Game Together | 1 |
| **Total** | | **8** |

### How Bots Work

1. **Admin enables** the bot globally in admin settings
2. **Admin configures** any required API keys or connections
3. **Admin grants** bot permission to user groups
4. **Optionally**, admin can enable/disable bots per channel
5. **Users** with permission can use the bot in enabled channels

---

## Streaming Bots

### YouTube Bot

Stream YouTube videos to voice channels for watch parties.

**Admin Setup:**
1. Go to **Settings** → **Administration** → **Media Bots** → **YouTube**
2. Enable the bot
3. No additional configuration required

**User Features:**
- Paste any YouTube URL to play
- Preview video info (title, thumbnail, duration) before playing
- See currently playing video
- Stop playback
- Multiple streams in different channels simultaneously

**How It Works:**
- Uses `ytdl-core` to extract stream URLs
- Every participant's client plays the video itself
- Supports videos, playlists (first video), and shorts

---

### Plex Bot

Stream media from your Plex Media Server library.

**Admin Setup:**
1. Go to **Settings** → **Administration** → **Media Bots** → **Plex**
2. Enable the bot
3. Enter your Plex server URL (e.g., `http://192.168.1.100:32400`)
4. Enter your Plex authentication token

**Getting Your Plex Token:**
1. Sign in to Plex web app
2. Open any media item
3. Open browser developer tools (F12)
4. Go to Network tab
5. Look for `X-Plex-Token` in any request

**User Features:**
- Search your entire Plex library
- Play movies, TV shows, music
- See what's currently playing
- Queue system for music

---

### Emby Bot

Stream media from Emby Media Server.

**Admin Setup:**
1. Go to **Settings** → **Administration** → **Media Bots** → **Emby**
2. Enable the bot
3. Enter Emby server URL (e.g., `http://192.168.1.100:8096`)
4. Enter API key (create in Emby: **Dashboard** → **API Keys**)

**User Features:**
- Search movies, series, music
- Thumbnail previews
- Playback in voice channels
- Episode selection for TV series

---

### Jellyfin Bot

Stream media from Jellyfin (free, open-source Plex/Emby alternative).

**Admin Setup:**
1. Go to **Settings** → **Administration** → **Media Bots** → **Jellyfin**
2. Enable the bot
3. Enter Jellyfin server URL
4. Enter API key (create in Jellyfin: **Dashboard** → **API Keys**)

**User Features:**
- Same features as Emby Bot
- Full Jellyfin API support

**Why this replaces "The Projectionist" (movie nights):**

Movie nights used to run through a Discord user account ("the projectionist") left
logged in on a VM, screen-sharing Kodi into a voice channel, with Kodi's web remote
port-forwarded on the home router so friends could control it. That setup was fragile
and exposed:

- Discord bots can't stream video into voice, so it needed a real user account kept
  logged in. Automating that account is a selfbot, which breaks Discord's ToS.
- Any logout, dropped screen share or VM hiccup meant someone had to go fix it.
- Kodi's web UI was open to the internet through router port forwards.
- Everyone watched a recompressed screen share instead of the actual file.

On Emberlan we run our own server, so the Jellyfin bot can play into voice channels
legitimately: no babysat account, every friend gets the real stream, and the whole
thing is reachable only over Tailscale (no router ports). Close the old Kodi port
forwards and retire the projectionist VM once this is running.

---

### IPTV Bot

Watch live TV together with electronic program guide (EPG).

**Admin Setup:**
1. Go to **Settings** → **Administration** → **Media Bots** → **IPTV**
2. Enable the bot
3. Enter M3U playlist URL from your IPTV provider
4. Optionally enter XMLTV EPG URL for TV guide data

**M3U Playlist Format:**
```
#EXTM3U
#EXTINF:-1 tvg-id="cnn" tvg-logo="logo.png" group-title="News",CNN
http://stream-url.com/cnn
#EXTINF:-1 tvg-id="espn" group-title="Sports",ESPN
http://stream-url.com/espn
```

**User Features:**
- Browse channels by group/category
- View TV guide (current and upcoming shows)
- Watch live channels in voice
- Change channels easily
- Schedule recordings
- Tag users on recordings

**Recording System:**
- Select a program from the EPG to record
- Recordings are tied to your account
- Tag other users to notify them
- View scheduled and completed recordings

---

### Twitch Bot

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

Play local multiplayer games together with virtual controllers.

**Admin Setup:**
1. Go to **Settings** → **Administration** → **Media Bots** → **Game Together**
2. Enable the bot
3. Install ViGEmBus driver on the gaming PC for virtual controller support

**How It Works:**
1. Host starts a Game Together session in a voice channel
2. Host shares their screen showing the game
3. Other users join as players (up to 4)
4. Each player gets a virtual controller
5. Players control the game using on-screen buttons or keyboard shortcuts

**User Features:**
- Virtual D-pad and buttons
- Analog stick support
- Works with any local multiplayer game
- Real-time input synchronization
- Up to 4 simultaneous players

**Use Cases:**
- Couch co-op games over the internet
- Fighting games with friends
- Local-multiplayer party games (Game Together, which does not yet drive real controllers; see [game-together.md](game-together.md))
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

1. Verify server has sufficient bandwidth
2. Check media server is accessible
3. Try lower quality preset

---

Have questions? [Open an issue](https://github.com/yourusername/emberlan/issues)!
