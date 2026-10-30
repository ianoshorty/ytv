// Small YouTube responses are essential on VIDAA's memory-limited HTTP worker.
(function (root) {
  'use strict';
  var ORIGIN = 'https://www.youtube.com', VERSION = '2.20261029.01.00';
  var PREFIX = 'contents/twoColumnBrowseResultsRenderer/tabs/tabRenderer/content/sectionListRenderer/contents/itemSectionRenderer/contents/';
  var shapes = [
    'videoRenderer(videoId,title,lengthText,thumbnailOverlays/thumbnailOverlayResumePlaybackRenderer/percentDurationWatched)',
    'compactVideoRenderer(videoId,title,lengthText,thumbnailOverlays/thumbnailOverlayResumePlaybackRenderer/percentDurationWatched)',
    'videoWithContextRenderer(videoId,headline,lengthText,thumbnailOverlays/thumbnailOverlayResumePlaybackRenderer/percentDurationWatched)',
    'lockupViewModel(contentId,contentType,metadata/lockupMetadataViewModel/title,contentImage/thumbnailViewModel/overlays/thumbnailBottomOverlayViewModel(progressBar/thumbnailOverlayProgressBarViewModel/startPercent,badges/thumbnailBadgeViewModel/text))',
    'continuationItemRenderer/continuationEndpoint/continuationCommand/token'
  ];
  var HISTORY_FIELDS = ['responseContext/mainAppWebResponseContext/loggedOut'].concat(shapes.map(function (s) { return PREFIX + s; })).join(',');
  var PLAYER_FIELDS = 'playabilityStatus/status,videoDetails(videoId,title,lengthSeconds),playbackTracking(videostatsPlaybackUrl/baseUrl,videostatsWatchtimeUrl/baseUrl)';
  var AGENT = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36';
  function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id); }
  function validateSession(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.cookies) || value.cookies.length > 80) throw new Error('Invalid sync session');
    var copy = { version: 1, clientVersion: VERSION, accountIndex: 0, importedAt: Date.now(), cookies: [] };
    value.cookies.forEach(function (c) {
      if (!c || ['.youtube.com', 'youtube.com', 'www.youtube.com', '.www.youtube.com'].indexOf(c.domain) < 0 || c.path !== '/' ||
          typeof c.name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.name) || typeof c.value !== 'string' || !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(c.value) ||
          !Number.isFinite(c.expires) || c.expires <= Date.now() / 1000 || c.partitionKey) return;
      copy.cookies.push({ name: c.name, value: c.value, domain: c.domain, path: '/', expires: c.expires });
    });
    var pairs = cookieMap(copy);
    if (!pairs['__Secure-3PSID']) throw new Error('Sync session needs replacing');
    if (!(pairs.SAPISID || pairs['__Secure-3PAPISID'])) throw new Error('Sync signing cookie unavailable');
    if (JSON.stringify(copy).length > 64000) throw new Error('Sync session too large');
    return copy;
  }
  function cookieMap(session) {
    var map = Object.create(null);
    (session.cookies || []).forEach(function (c) { if (c.expires > Date.now() / 1000) map[c.name] = c.value; });
    return map;
  }
  async function authorization(session) {
    var cookies = cookieMap(session), stamp = Math.floor(Date.now() / 1000), parts = [];
    if (!cookies['__Secure-3PSID'] || !(cookies.SAPISID || cookies['__Secure-3PAPISID'])) throw new Error('Sync session needs replacing');
    for (var pair of [['SAPISIDHASH', cookies.SAPISID || cookies['__Secure-3PAPISID']], ['SAPISID1PHASH', cookies['__Secure-1PAPISID']], ['SAPISID3PHASH', cookies['__Secure-3PAPISID']]]) {
      if (!pair[1]) continue;
      var digest = await root.crypto.subtle.digest('SHA-1', new TextEncoder().encode(stamp + ' ' + pair[1] + ' ' + ORIGIN));
      parts.push(pair[0] + ' ' + stamp + '_' + Array.from(new Uint8Array(digest)).map(function (v) { return v.toString(16).padStart(2, '0'); }).join(''));
    }
    return parts.join(' ');
  }
  function cookieHeader(session) {
    var map = cookieMap(session);
    return Object.keys(map).map(function (name) { return name + '=' + map[name]; }).join('; ');
  }
  async function apiArgs(session, endpoint, data) {
    if (endpoint !== 'browse' && endpoint !== 'player') throw new Error('Unsupported sync endpoint');
    var fields = endpoint === 'browse' ? HISTORY_FIELDS : PLAYER_FIELDS;
    if (endpoint === 'player' && !validId(data.videoId)) throw new Error('Invalid video ID');
    var context = { client: { clientName: 'WEB', clientVersion: VERSION, userAgent: AGENT, hl: 'en', gl: 'GB' } };
    return {
      url: ORIGIN + '/youtubei/v1/' + endpoint + '?prettyPrint=false&fields=' + encodeURIComponent(fields),
      method: 'post', timeout: 15, withCredentials: false, certLapsedFunctional: false,
      custom_headers: { Cookie: cookieHeader(session), Authorization: await authorization(session),
        'Content-Type': 'application/json', Origin: ORIGIN, 'X-Origin': ORIGIN, 'X-Goog-AuthUser': '0',
        'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': VERSION,
        'X-Youtube-Bootstrap-Logged-In': 'true', 'User-Agent': AGENT },
      data: Object.assign({ context: context }, data)
    };
  }
  function text(t) { return typeof t === 'string' ? t : t && (t.simpleText || t.content || (t.runs || []).map(function (r) { return r.text || ''; }).join('')) || ''; }
  function seconds(t) {
    if (!/^\d+:\d\d(?::\d\d)?$/.test(t)) return 0;
    return t.split(':').reduce(function (n, p) { return n * 60 + Number(p); }, 0);
  }
  function percent(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v / 100 : null; }
  function progress(v, lockup) {
    var fraction = null, duration = seconds(text(v.lengthText));
    if (lockup) {
      var overlays = v.contentImage && v.contentImage.thumbnailViewModel && v.contentImage.thumbnailViewModel.overlays || [];
      overlays.forEach(function (o) {
        var b = o.thumbnailBottomOverlayViewModel;
        if (!b) return;
        if (b.progressBar && b.progressBar.thumbnailOverlayProgressBarViewModel) fraction = percent(b.progressBar.thumbnailOverlayProgressBarViewModel.startPercent);
        (b.badges || []).forEach(function (badge) { duration = seconds(text(badge.thumbnailBadgeViewModel && badge.thumbnailBadgeViewModel.text)) || duration; });
      });
    } else (v.thumbnailOverlays || []).forEach(function (o) { if (o.thumbnailOverlayResumePlaybackRenderer) fraction = percent(o.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched); });
    return { fraction: fraction, seconds: duration || null };
  }
  function parseHistory(data) {
    var out = [], seen = Object.create(null), stack = [data && data.contents], count = 0;
    while (stack.length && count++ < 50000 && out.length < 1000) {
      var item = stack.pop();
      if (!item || typeof item !== 'object') continue;
      var v = item.videoRenderer || item.compactVideoRenderer || item.videoWithContextRenderer;
      var l = item.lockupViewModel;
      if (l && l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') v = l;
      var id = v && (v.videoId || v.contentId);
      if (validId(id) && !seen[id]) {
        seen[id] = true;
        var title = l === v ? text(l.metadata && l.metadata.lockupMetadataViewModel && l.metadata.lockupMetadataViewModel.title) : text(v.title || v.headline);
        out.push(Object.assign({ id: id, title: title || id, thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg', channel: '', fromYouTube: true }, progress(v, l === v)));
      }
      var children = Array.isArray(item) ? item : Object.keys(item).map(function (k) { return item[k]; });
      for (var i = children.length - 1; i >= 0; i--) if (children[i] && typeof children[i] === 'object') stack.push(children[i]);
    }
    return out;
  }
  function tracking(data, id) {
    if (!validId(id) || !data || !data.videoDetails || data.videoDetails.videoId !== id || data.playabilityStatus.status !== 'OK') throw new Error('Video cannot be synced');
    return ['videostatsPlaybackUrl', 'videostatsWatchtimeUrl'].map(function (name, i) {
      var u = new URL(data.playbackTracking[name].baseUrl);
      if (u.protocol !== 'https:' || ['www.youtube.com', 'm.youtube.com', 's.youtube.com'].indexOf(u.host) < 0 || u.username || u.password || u.hash ||
          u.pathname !== '/api/stats/' + (i ? 'watchtime' : 'playback') || (u.searchParams.has('docid') && u.searchParams.get('docid') !== id)) throw new Error('Unexpected sync address');
      u.hostname = 'www.youtube.com'; u.searchParams.set('docid', id); return u.href;
    });
  }
  function statsArgs(session, base, id, cpn, range, position, final, playback) {
    var u = new URL(base), expected = playback ? 'playback' : 'watchtime';
    if (!Number.isFinite(position) || position < 0 || !range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end < range.start) throw new Error('Invalid watched interval');
    if (!validId(id) || u.origin !== ORIGIN || u.pathname !== '/api/stats/' + expected || u.searchParams.get('docid') !== id || !/^[A-Za-z0-9_-]{16}$/.test(cpn)) throw new Error('Invalid watched update');
    var p = { ver: '2', c: 'web', cver: VERSION, cbrver: VERSION, cpn: cpn, cmt: String(position), el: 'detailpage' };
    if (playback) Object.assign(p, { fmt: '251', rt: '0', rtn: '0' });
    else Object.assign(p, { st: String(range.start), et: String(range.end), final: final ? '1' : '0' });
    Object.keys(p).forEach(function (key) { u.searchParams.set(key, p[key]); });
    return { url: u.href, method: 'get', timeout: 15, withCredentials: false, certLapsedFunctional: false, custom_headers: { Cookie: cookieHeader(session), 'User-Agent': AGENT } };
  }
  var core = { validateSession: validateSession, validId: validId, apiArgs: apiArgs, parseHistory: parseHistory, tracking: tracking, statsArgs: statsArgs, HISTORY_FIELDS: HISTORY_FIELDS };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.YTVSyncCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : window);
