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

**0.5: Phase 1, sign-in, subscriptions, resume, and send from your phone.**

- **Home:** "Continue watching on this TV", then the newest uploads across your
  subscriptions (cached for 30 minutes)
- **Recent:** everything played in YTV on this TV, with progress bars; videos
  resume where you stopped (YouTube's own history isn't available to apps)
- **Send to TV:** save a video to your YouTube playlist called "TV" (e.g. on
  your phone) and YTV plays it within about 10 seconds while it's open, or
  offers it (Blue) if something's already playing. Read-only access means it
  can't remove videos from the playlist, so it remembers what it has played
- **Subscriptions:** your channels A–Z, each opening its uploads
- **Search:** on-screen keyboard (number keys type digits), recent searches
- **Player:** full screen, speed 0.25–2x, captions toggle and a quality
  setting, all remembered between videos
- **Controls:** a list of what every remote button does
- **Account:** sign in with a code at google.com/device, sign out (revokes the
  token), hide Shorts, today's API usage

Remote, browsing: arrows move · OK select · Back goes back (twice on Home
exits).
Remote, playing: OK play/pause · ←/→ 10 s · rewind/fast-forward 30 s ·
↑/↓ speed · 0–9 jump to 0–90% · Red info · Green captions · Yellow quality · Blue play what your phone sent ·
Back or Stop close.

The embedded player can't be told a quality directly, so the quality setting
changes the size the player is laid out at, which YouTube uses to choose. The
info bar shows what was asked for and what YouTube is playing.

Try it without any keys at `https://ianoshorty.github.io/ytv/?mock=1`
(sample data).

### How keys reach the app

The API key and sign-in client details are not in this repo. The installer
adds them to the TV's app entry after `#cfg=` in the address. Browsers never
send that part to a server; the app saves it on the TV and removes it from
the address. Sign-in uses Google's TV code flow with read-only YouTube access,
and the tokens stay on the TV.

### Planned

1. Liked videos and playlists
2. Watch history with resume points, and a smarter home dashboard
3. Polish: settings, quality options

## Notes

Player-session setup notes are kept separately in the private workspace file
`YOUTUBE_PREMIUM.md` (outside this public repository).

- Unofficial, personal project. Not affiliated with YouTube, Google or Hisense.
- This repo is public (GitHub Pages on the free plan), so it must never contain
  secrets, account details or personal data.
