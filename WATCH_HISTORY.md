# Watch history

Current behavior in YTV **0.9.2**, documented 30 October 2026. This is the
reference for watch-history behavior and implementation; the main README keeps
only the feature overview and controls. Private connection/recovery tools and
account-specific findings remain outside this public repository.

## The three lists

| List | Source | Limit |
| --- | --- | --- |
| Recent | Playback records saved by YTV on this TV | No list cap |
| Continue watching | Eligible local records combined with imported YouTube history, deduplicated by video ID | No display cap |
| YouTube history | The most recently fetched history response from YouTube | Recent snapshot; not an all-time import |

Continue watching includes non-live videos with at least 15 seconds of saved
progress that are not complete. At least 95% counts as complete. When YouTube
provides a progress percentage and duration, YTV can estimate a resume point.
An entry without a progress percentage is only labelled **In history**; its
presence alone does not mean it is complete or eligible for Continue watching.
Resume normally starts three seconds before the saved position. It is approximate,
especially when based on YouTube's rounded progress rather than a local position.

The **12-video limit applies only to the manual Sync progress to YouTube
button**. It does not trim storage, Recent, Continue watching or the imported
YouTube history. Version 0.9.0 briefly trimmed local history to 12; 0.9.1 removed
that behavior. Local-only records already discarded by that version cannot be
reconstructed automatically.

## Controls

Hold **OK** on a video card for about a second (650 ms) to open its menu. A
short press plays on release. Held-key repeats and release after opening the
menu do not accidentally select an action. Back cancels.

### Mark completely watched

With history sync enabled, YTV reads the video's duration and reporting URLs,
sends a full-duration watched report, then marks it complete locally. With sync
paused or unconnected, the action is explicitly labelled as applying **on this
TV** only. A local manual completion takes precedence over stale cloud progress
until subsequent local playback replaces that marker.

After success, the matching Continue watching tile immediately becomes
unfocusable and fades/collapses over roughly a quarter of a second. Tiles to its
right slide left. Focus moves to the next available tile, or the previous one;
an empty row and its heading disappear. Other rows that hide completed videos
also remove the matching cards. This does not require reopening Home.

### Remove from history

**Remove from YouTube watch history** requires enabled sync and a second
confirmation. YTV fetches the history removal controls, selects only the
matching video's **DELETE** feedback token, and submits it to YouTube. It
requires YouTube's `isProcessed: true` acknowledgment before removing the local
record, cached cloud entry and older queued updates for that video.

If the video or its delete control is absent from the fetched recent feed, YTV
refuses the cloud removal. It never substitutes a recommendation/Not Interested
control. A successful removal also dismisses the Continue watching tile with
the animation described above.

**Remove from Recent on this TV only** deletes the local record and dismisses
its current Continue watching tile, without requesting YouTube deletion. It
does not clear the cloud entry or cancel already queued playback reports. If
YouTube still supplies unfinished progress, the video can appear again when
Home is rebuilt. The menu currently offers removal rather than a separate
watched/unwatched toggle.

### Sync progress to YouTube

In Recent, select **Sync progress to YouTube**:

1. Snapshot the latest **12 raw local playback records**, not the merged
   progress used to draw the tiles. Older records remain saved and visible.
2. Fetch a fresh recent-history snapshot from YouTube.
3. Skip videos whose cloud progress is equal or further ahead. Also skip live
   videos, invalid IDs, and local records with zero progress or no duration.
4. If cloud progress is unknown, skip a partial local record; a locally complete
   record can safely report 100%. A video absent from the snapshot is eligible.
5. For each eligible video, fetch its reporting URLs and actual duration, then
   send one playback request and one watchtime request. A complete local record
   reports the full duration; other records report their saved position.

The action uses one history read and at most **12 player lookups plus 24 stats
requests**, with existing session health checks when needed. Requests are
sequential. An acknowledged manual target is not sent again for ten minutes
while YouTube catches up. The result shows updated, skipped and already-sent
counts; an unconfirmed write stops the remaining batch without an automatic
retry. An HTTP acknowledgment means the request was accepted, not independent
proof that the phone's History has already refreshed.

## How syncing works

### Separate account connections

The Google device-code sign-in used for subscriptions and the TV playlist still
uses read-only YouTube Data API access. It is not the history connection.

Optional history sync uses a separate YouTube web session connected once and
stored on the TV. YTV makes requests through VIDAA's existing local HTTP fetcher,
which performs the HTTPS requests outside the web page's browser CORS rules.
Its native HTTP client does not share the embedded player's browser cookie jar.
The player session used for Premium playback remains separate. No phone or
computer companion needs to stay running, and no extra Google OAuth permission
is requested by this history implementation.

The native service is firmware-specific. History requests use undocumented
YouTube web endpoints; compatibility and session lifetime are not guaranteed.
The copied session is an account credential, not a public app configuration.
Never publish its cookies, generated connection pages or authorization headers.

### Reading YouTube history

YTV signs an authenticated `/youtubei/v1/browse` request with
`browseId: FEhistory`. The request uses the stored session cookies, YouTube's
origin-bound timestamped authorization hashes, and WEB client context. Cookie
signing has a SHA-1 fallback for TV contexts without SubtleCrypto.

A minimal `fields` selector keeps the native response small. Full authenticated
history responses exhausted the TV HTTP worker's small heap during development.
The parser handles legacy video renderers and newer lockup view models, including
available duration and resume-progress overlays. Reading history does not itself
report anything as watched.

The snapshot is cached on the TV. While sync is enabled, a 30-second task checks
whether the snapshot is over five minutes old and refreshes it when playback is
closed. Account and the YouTube history screen also offer refresh. The current
implementation does not fetch continuation pages, so an uncapped display does
not imply complete YouTube history coverage.

For overlapping records, YTV generally uses the imported cloud progress. Local
progress takes precedence when there is pending playback, the local record is
newer than the snapshot, the cloud percentage is unknown, or the user explicitly
marked the video complete locally. Mere history import never creates a watched
report.

### Reporting actual playback

Local progress and native reporting are separate. YTV saves the local position
while playing. With sync enabled it also samples actual playback intervals,
rejecting large position jumps as seeks. Watched intervals are queued after
three seconds of real playback, or at the end when an interval exists. A seek
alone is not reported as watched time.

For queued reports, `/youtubei/v1/player` supplies the video's playback and
watchtime reporting URLs. YTV validates their hosts, paths and video IDs,
normalizes them to the YouTube web host, and sends playback/watchtime signals
with a per-playback correlation ID. HTTP 200 and 204 are accepted. Pending
intervals are flushed periodically and on pause/close; only acknowledged
intervals are removed from the queue. Reporting URLs are briefly cached.

A failed response may still have reached YouTube. Ambiguous automatic writes
are held for explicit **Retry pending updates** in Account. Manual corrections
wait for an existing automatic write, block competing manual/background writes,
and never enqueue their own automatic retry. A successful manual correction
clears older queued intervals for that video; an ambiguous correction holds
related older jobs as uncertain. Replacement connections do not inherit old
queued jobs.

### Keeping the native session alive

When its health check is due (three-minute interval), the existing native
`fetchHead` operation retrieves YouTube response headers. YTV merges valid
YouTube cookie updates into its stored native session, then checks signed-in
status with a small history request. It does not write those cookies into the
player's browser cookie jar. A signed-out response pauses sync. This maintenance
can retain refreshed cookies but cannot prevent Google expiring or revoking a
session; reconnection may eventually be necessary.

## Known limits and verification

- Local progress and YouTube progress are not an exact, transactional mirror.
  The user reported rare missed cloud updates, often on shorter videos; the
  automatic sampling issue was deliberately left unchanged. Manual completion
  and latest-12 catch-up provide corrections.
- Recent history coverage, rounded/missing percentages, delayed cloud updates
  and session expiry limit cross-device resume accuracy. No all-time coverage
  or permanent-session guarantee is made.
- Removing a cloud history entry is confirmed by YouTube's deletion response;
  local-only removal has the different behavior described above. There is no
  bulk cloud deletion action.
- Local history uses browser storage. Clearing app data or a storage failure can
  lose local records; uncapped lists do not provide a cloud backup of those records.
- Native history reads/writes and coexistence with Premium were confirmed on
  the target TV. The context menu was also user-confirmed. The 0.9.1 list fix
  and 0.9.2 dismissal were checked with fixtures and a sample-data browser;
  those checks are distinct from testing every action against a live account.

## Code map

| File | Responsibility |
| --- | --- |
| [history.js](js/history.js) | Raw local records, cloud/local merge, resume and completion rules |
| [sync-core.js](js/sync-core.js) | Session validation/signing, small request filters, history parsing, URL validation and deletion-token selection |
| [sync.js](js/sync.js) | Native transport, session maintenance, history cache, playback queue and manual operations |
| [context.js](js/context.js) | Held-OK menu, confirmation, success/error handling and focus restoration |
| [nav.js](js/nav.js) | Tile progress and Continue watching dismissal |
| [screens.js](js/screens.js) | Home/Recent/YouTube history/Account controls |
| [app.css](app.css) | Fade and row-collapse animation |

The removal implementation follows the per-video DELETE-control pattern in
[YouTube.js History](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/youtube/History.ts)
and its [FeedbackEndpoint](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/endpoints/FeedbackEndpoint.ts).
These are implementation references, not a supported Google API contract.
