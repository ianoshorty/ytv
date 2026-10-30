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
  // Requested only for an explicit removal; normal history reads stay unchanged.
  var DELETE_ENDPOINT = 'feedbackEndpoint(feedbackToken,shouldMerge,isFeedbackTokenUnencrypted)';
  var REMOVE_FIELDS = 'responseContext/mainAppWebResponseContext/loggedOut,' + PREFIX +
    'videoRenderer(videoId,menu/menuRenderer/items/menuServiceItemRenderer(icon/iconType,serviceEndpoint/' + DELETE_ENDPOINT + ')),' + PREFIX +
    'lockupViewModel(contentId,contentType,metadata/lockupMetadataViewModel/menuButton/buttonViewModel/onTap/innertubeCommand/showSheetCommand/panelLoadingStrategy/inlineContent/sheetViewModel/content/listViewModel/listItems/listItemViewModel(leadingImage/sources/clientResource/imageName,rendererContext/commandContext/onTap/innertubeCommand/' + DELETE_ENDPOINT + '))';
  var PLAYER_FIELDS = 'playabilityStatus/status,videoDetails(videoId,title,lengthSeconds),playbackTracking(videostatsPlaybackUrl/baseUrl,videostatsWatchtimeUrl/baseUrl)';
  var AGENT = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36';
  function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id); }
  function validateSession(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.cookies) || value.cookies.length > 80) throw new Error('Invalid sync session');
    var copy = { version: 1, clientVersion: VERSION, accountIndex: 0, importedAt: Number.isFinite(value.importedAt) ? value.importedAt : Date.now(), cookies: [] };
    value.cookies.forEach(function (c) {
      if (!c || ['.youtube.com', 'youtube.com', 'www.youtube.com', '.www.youtube.com'].indexOf(c.domain) < 0 || c.path !== '/' ||
          typeof c.name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.name) || typeof c.value !== 'string' || !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(c.value) ||
          !Number.isFinite(c.expires) || c.expires <= Date.now() / 1000 || c.partitionKey) return;
      copy.cookies.push({ name: c.name, value: c.value, domain: c.domain, path: '/', expires: c.expires });
    });
    var pairs = cookieMap(copy);
    if (!pairs['__Secure-3PSID']) throw new Error('Sync session needs replacing');
    if (!pairs.LOGIN_INFO) throw new Error('Sync login cookie unavailable');
    if (!(pairs.SAPISID || pairs['__Secure-3PAPISID'])) throw new Error('Sync signing cookie unavailable');
    if (JSON.stringify(copy).length > 64000) throw new Error('Sync session too large');
    return copy;
  }
  function mergeCookies(session, updates) {
    var copy = validateSession(session), now = Date.now() / 1000;
    if (typeof updates === 'string') updates = [updates];
    if (!Array.isArray(updates)) return copy;
    updates.slice(0, 80).forEach(function (line) {
      if (typeof line !== 'string' || line.length > 16000) return;
      var parts = line.split(';'), first = parts.shift(), split = first.indexOf('=');
      if (split < 1) return;
      var name = first.slice(0, split).trim(), value = first.slice(split + 1).trim(), attrs = Object.create(null);
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(value)) return;
      parts.forEach(function (part) { var i = part.indexOf('='); attrs[(i < 0 ? part : part.slice(0, i)).trim().toLowerCase()] = i < 0 ? true : part.slice(i + 1).trim(); });
      var domain = String(attrs.domain || 'www.youtube.com').toLowerCase().replace(/^\./, ''), path = attrs.path || '/';
      if (['youtube.com', 'www.youtube.com'].indexOf(domain) < 0 || path !== '/') return;
      if (/^(__Secure-|__Host-)/.test(name) && attrs.secure !== true) return;
      if (name.indexOf('__Host-') === 0 && attrs.domain) return;
      var previous = copy.cookies.filter(function (c) { return c.name === name && c.domain.replace(/^\./, '') === domain; })[0];
      var expiry = typeof attrs.expires === 'string' ? Date.parse(attrs.expires) / 1000 : NaN;
      if (typeof attrs['max-age'] === 'string' && /^-?\d+$/.test(attrs['max-age'])) expiry = now + Number(attrs['max-age']);
      // Do not invent a persistent lifetime for a new session-only cookie.
      if (!Number.isFinite(expiry)) expiry = previous ? previous.expires : NaN;
      if (!Number.isFinite(expiry)) return;
      copy.cookies = copy.cookies.filter(function (c) { return !(c.name === name && c.domain.replace(/^\./, '') === domain); });
      if (value && expiry > now) copy.cookies.push({ name: name, value: value, domain: attrs.domain ? '.' + domain : domain, path: '/', expires: expiry });
    });
    return validateSession(copy);
  }
  function cookieMap(session) {
    var map = Object.create(null);
    (session.cookies || []).forEach(function (c) { if (c.expires > Date.now() / 1000) map[c.name] = c.value; });
    return map;
  }
  // Some VIDAA app contexts expose random values but no SubtleCrypto. SHA-1
  // is required by YouTube's cookie-auth protocol; keep a verified fallback.
  function sha1(input) {
    var bytes = encodeURIComponent(input).replace(/%([0-9a-f]{2})/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); });
    var words = [], n = bytes.length, i, t;
    for (i = 0; i < n; i++) words[i >> 2] = (words[i >> 2] || 0) | bytes.charCodeAt(i) << (24 - i % 4 * 8);
    words[n >> 2] = (words[n >> 2] || 0) | 0x80 << (24 - n % 4 * 8);
    words[(((n + 8) >> 6) + 1) * 16 - 1] = n * 8;
    var h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    function rotate(v, bits) { return v << bits | v >>> (32 - bits); }
    for (i = 0; i < words.length; i += 16) {
      var w = [], a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
      for (t = 0; t < 80; t++) {
        w[t] = t < 16 ? words[i + t] || 0 : rotate(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
        var f = t < 20 ? b & c | ~b & d : t < 40 ? b ^ c ^ d : t < 60 ? b & c | b & d | c & d : b ^ c ^ d;
        var k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        var next = (rotate(a, 5) + f + e + k + w[t]) | 0;
        e = d; d = c; c = rotate(b, 30); b = a; a = next;
      }
      h[0] = h[0] + a | 0; h[1] = h[1] + b | 0; h[2] = h[2] + c | 0; h[3] = h[3] + d | 0; h[4] = h[4] + e | 0;
    }
    return h.map(function (v) { return (v >>> 0).toString(16).padStart(8, '0'); }).join('');
  }
  async function digest(input) {
    try {
      if (root.crypto && root.crypto.subtle && typeof TextEncoder !== 'undefined') {
        var bytes = await root.crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
        return Array.from(new Uint8Array(bytes)).map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
      }
    } catch (_) {}
    return sha1(input);
  }
  async function authorization(session) {
    var cookies = cookieMap(session), stamp = Math.floor(Date.now() / 1000), parts = [];
    if (!cookies['__Secure-3PSID'] || !(cookies.SAPISID || cookies['__Secure-3PAPISID'])) throw new Error('Sync session needs replacing');
    for (var pair of [['SAPISIDHASH', cookies.SAPISID || cookies['__Secure-3PAPISID']], ['SAPISID1PHASH', cookies['__Secure-1PAPISID']], ['SAPISID3PHASH', cookies['__Secure-3PAPISID']]]) {
      if (!pair[1]) continue;
      parts.push(pair[0] + ' ' + stamp + '_' + await digest(stamp + ' ' + pair[1] + ' ' + ORIGIN));
    }
    return parts.join(' ');
  }
  function cookieHeader(session) {
    var map = cookieMap(session);
    return Object.keys(map).map(function (name) { return name + '=' + map[name]; }).join('; ');
  }
  async function apiArgs(session, endpoint, data) {
    if (['browse', 'player', 'feedback'].indexOf(endpoint) < 0) throw new Error('Unsupported sync endpoint');
    var fields = endpoint === 'browse' ? HISTORY_FIELDS : endpoint === 'feedback' ? 'feedbackResponses/isProcessed' : PLAYER_FIELDS;
    if (endpoint === 'feedback' && (!data || !Array.isArray(data.feedbackTokens) || data.feedbackTokens.length !== 1 || typeof data.feedbackTokens[0] !== 'string' || !data.feedbackTokens[0] || data.feedbackTokens[0].length > 16000)) throw new Error('Invalid removal token');
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
  function removal(data, id) {
    // Never take a generic recommendation/Not Interested token. Only the
    // DELETE control belonging to this video in the history feed is allowed.
    if (!validId(id)) return null;
    var stack = [data && data.contents], count = 0;
    while (stack.length && count++ < 50000) {
      var item = stack.pop();
      if (!item || typeof item !== 'object') continue;
      var v = item.videoRenderer, l = item.lockupViewModel, candidates = [];
      if (v && v.videoId === id) {
        candidates = (v.menu && v.menu.menuRenderer && v.menu.menuRenderer.items || []).map(function (i) {
          var m = i.menuServiceItemRenderer;
          return m && m.icon && m.icon.iconType === 'DELETE' && m.serviceEndpoint && m.serviceEndpoint.feedbackEndpoint;
        });
      }
      if (l && l.contentId === id && l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
        var menu = l.metadata && l.metadata.lockupMetadataViewModel && l.metadata.lockupMetadataViewModel.menuButton;
        var command = menu && menu.buttonViewModel && menu.buttonViewModel.onTap && menu.buttonViewModel.onTap.innertubeCommand;
        var strategy = command && command.showSheetCommand && command.showSheetCommand.panelLoadingStrategy;
        var sheet = strategy && strategy.inlineContent && strategy.inlineContent.sheetViewModel;
        var list = sheet && sheet.content && sheet.content.listViewModel;
        candidates = (list && list.listItems || []).map(function (i) {
          var m = i.listItemViewModel;
          if (!m || !(m.leadingImage && m.leadingImage.sources || []).some(function (image) { return image.clientResource && image.clientResource.imageName === 'DELETE'; })) return null;
          var tap = m.rendererContext && m.rendererContext.commandContext && m.rendererContext.commandContext.onTap;
          return tap && tap.innertubeCommand && tap.innertubeCommand.feedbackEndpoint;
        });
      }
      for (var c of candidates) if (c && typeof c.feedbackToken === 'string' && c.feedbackToken.length && c.feedbackToken.length <= 16000) {
        return { feedbackTokens: [c.feedbackToken], shouldMerge: !!c.shouldMerge, isFeedbackTokenUnencrypted: !!c.isFeedbackTokenUnencrypted };
      }
      var children = Array.isArray(item) ? item : Object.keys(item).map(function (k) { return item[k]; });
      for (var j = children.length - 1; j >= 0; j--) if (children[j] && typeof children[j] === 'object') stack.push(children[j]);
    }
    return null;
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
  var core = { removal: removal, REMOVE_FIELDS: REMOVE_FIELDS, validateSession: validateSession, mergeCookies: mergeCookies, validId: validId, apiArgs: apiArgs, parseHistory: parseHistory, tracking: tracking, statsArgs: statsArgs, sha1: sha1, HISTORY_FIELDS: HISTORY_FIELDS };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.YTVSyncCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : window);
