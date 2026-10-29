# YTV

A personal YouTube app for a Hisense VIDAA TV. It's a web app hosted on
GitHub Pages and installed on the TV as an app tile.

## Why

The TV's built-in YouTube app plays 60 fps video at full quality at 1x. As soon
as you speed playback up, it drops 60 fps video to 480p. Picking a higher
quality again resets the speed to 1x. The TV's hardware isn't the limit:
YouTube's embedded web player, running in the TV's own browser engine, plays the
same videos at **1080p60 at 1.5x and 2x without stutter**.

YTV is built around that embedded player.

## What we found on this TV

Tested on a Hisense 55U7KQTUK (UK, VIDAA, firmware V0000.09.09O.P0930,
Chrome 111 engine):

| Finding | Detail |
| --- | --- |
| Codecs | VP9, AV1 and HEVC all report 4K60 hardware decoding |
| 1080p60 at 2x | Smooth in the embedded player |
| 1440p / 4K | YouTube steps back down to 1080p within ~20 s, even at 1x (tested on a 4K HDR video). Network was ruled out (~250 Mbps to the TV) |
| Page size | The TV browser reports 1280x720 at 1.5x; installed apps report 1280x720 at 1x |
| Quality choice | YouTube picks quality from the player's size in real pixels, so YTV lays the player out at 1920x1080 real pixels and shrinks it into its box |
| Remote | Arrows, OK (13), Back (8) and number keys arrive as normal key events in an installed app |
| Caching | The TV keeps an app's page until a full restart, so YTV loads its code with a timestamp on every launch |

## How it's installed

VIDAA only lets pages served from `vidaahub.com` install web apps. The
community approach, used here, is to briefly point the TV's DNS at a computer
on the same network that answers for `vidaahub.com` and serves an installer
page. That page calls the TV's own install functions, then the TV's DNS goes
back to automatic.

On this firmware Hisense's official install call was accepted but never added a
tile. Writing the entry into the TV's web-app list worked, after the installer
saved a copy of that list so it can be put back exactly. Uninstall and restore
use the same page. Nothing is rooted or flashed.

The installer isn't in this repo. It's built on what these projects documented:
[vidaa-appstore](https://github.com/trialuser/vidaa-appstore),
[vidaa-custom-app](https://github.com/arashbehmand/vidaa-custom-app) and
[stremio-vidaa-tv](https://github.com/NoobyGains/stremio-vidaa-tv).

## Status

**Phase 0, platform check** (this version). The app shows checks (version,
launch counter, page size, player size, firmware) and the codes of remote keys
pressed, and plays test videos with speed control.

Remote: OK play/pause · ←/→ seek 10 s · ↑/↓ speed · Red or 1 full screen ·
2 next test video · Back twice exit.

### Planned

1. Player, speed control and search (YouTube Data API key)
2. Sign in with the TV code flow (google.com/device), subscriptions, liked
   videos and playlists
3. Watch history with resume points, and a home dashboard built from
   subscriptions and viewing
4. Polish: on-screen keyboard, settings, quality options

## Notes

- Unofficial, personal project. Not affiliated with YouTube, Google or Hisense.
- Uses YouTube's official embedded player and doesn't block or skip ads.
  YouTube Premium is the way to go ad-free.
- This repo is public (GitHub Pages on the free plan), so it must never contain
  secrets, account details or personal data.
