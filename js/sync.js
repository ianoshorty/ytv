// Uses the TV's existing HTTP service. Disabled until a separate session is
// connected and the user enables sync. Never changes YouTube browser cookies.
(function () {
  'use strict';
  var YTV = window.YTV, Core = window.YTVSyncCore;
  var jobs = YTV.store.get('syncOutbox', []), current = null, flushing = null, pulling = null;
  var metadata = {}, timer, pullAt = 0;
  var healthAt = 0, renewing = null, manual = null;
  var LOGIN_FIELDS = 'responseContext/mainAppWebResponseContext/loggedOut';
  var connectionId = (YTV.store.get('syncSession', {}) || {}).importedAt || 0;
  jobs.forEach(function (j) { if (j.connectionId == null) j.connectionId = connectionId; });
  var status = 'Not connected';
  function refreshConnection() {
    var id = (YTV.store.get('syncSession', {}) || {}).importedAt || 0;
    if (id === connectionId) return;
    connectionId = id;
    jobs = YTV.store.get('syncOutbox', []).filter(function (j) { return j.connectionId === id; });
    current = null; metadata = {}; healthAt = 0;
  }
  function enabled() { refreshConnection(); return !YTV.MOCK && YTV.store.get('syncEnabled', false); }
  function session() { refreshConnection(); return Core.validateSession(YTV.store.get('syncSession', null)); }
  function persist() { refreshConnection(); YTV.store.set('syncOutbox', jobs.slice(-40)); }
  function cache() { return YTV.store.get('syncRemote', { items: [], at: 0 }); }
  function failure(code) { var error = new Error(code); error.syncCode = code; return error; }
  async function native(args, kind) {
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 25000);
    try {
      var r = await fetch('http://localhost:9009/service/basic/fetcher', {
        method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api: kind || 'fetchResponse', args: args })
      });
      if (!r.ok) throw failure('TV_HTTP_' + r.status);
      try { return await r.json(); } catch (_) { throw failure('TV_RESPONSE_FORMAT'); }
    } catch (e) {
      if (e.syncCode) throw e;
      throw failure(e.name === 'AbortError' ? 'TV_TIMEOUT' : 'TV_CONNECTION');
    } finally { clearTimeout(timeout); }
  }
  async function api(endpoint, body, fields) {
    var args;
    try { args = await Core.apiArgs(session(), endpoint, body); } catch (_) { throw failure('SIGN_REQUEST'); }
    if (fields) { var url = new URL(args.url); url.searchParams.set('fields', fields); args.url = url.href; }
    var response = await native(args);
    if (response.ret !== true) throw failure('YOUTUBE_' + (response.msg && typeof response.msg.status === 'number' ? response.msg.status : 'SERVICE'));
    try { return typeof response.msg === 'string' ? JSON.parse(response.msg) : response.msg; } catch (_) { throw failure('YOUTUBE_RESPONSE_FORMAT'); }
  }
  function loggedOut(data) { return data && data.responseContext && data.responseContext.mainAppWebResponseContext && data.responseContext.mainAppWebResponseContext.loggedOut; }
  function requireLogin(data) {
    if (loggedOut(data) === true) {
      YTV.store.set('syncEnabled', false); current = null;
      throw failure('SESSION_SIGNED_OUT');
    }
    if (loggedOut(data) !== false) throw failure('SESSION_STATUS_MISSING');
  }
  function keepSession() {
    if (Date.now() - healthAt < 3 * 60000) return Promise.resolve();
    if (renewing) return renewing;
    renewing = (async function () {
      var original = JSON.stringify(YTV.store.get('syncSession', null));
      var args = await Core.apiArgs(session(), 'browse', { browseId: 'FEhistory' });
      var url = new URL(args.url); url.searchParams.set('fields', LOGIN_FIELDS); args.url = url.href;
      // fetchHead returns headers as JSON, making Set-Cookie available without
      // changing the browser cookie jar or buffering a full history response.
      var response = await native(args, 'fetchHead');
      if (response.ret !== true || !response.msg || typeof response.msg !== 'object') throw failure('SESSION_REFRESH');
      if (JSON.stringify(YTV.store.get('syncSession', null)) !== original) throw failure('SESSION_CHANGED');
      var updated;
      try { updated = Core.mergeCookies(session(), response.msg['set-cookie'] || response.msg['Set-Cookie']); }
      catch (_) { YTV.store.set('syncEnabled', false); current = null; throw failure('SESSION_COOKIE_CLEARED'); }
      YTV.store.set('syncSession', updated);
      if (JSON.stringify(YTV.store.get('syncSession', null)) !== JSON.stringify(updated)) throw failure('SESSION_STORAGE');
      requireLogin(await api('browse', { browseId: 'FEhistory' }, LOGIN_FIELDS));
      healthAt = Date.now();
    })().finally(function () { renewing = null; });
    return renewing;
  }
  function pull(internal) {
    if (manual && !internal) return manual.then(function () { return cache().items; });
    if (pulling) return pulling;
    pulling = (async function () {
      status = 'Reading YouTube history…';
      refreshConnection();
      var readingConnection = connectionId;
      var data = await api('browse', { browseId: 'FEhistory' });
      refreshConnection();
      if (readingConnection !== connectionId) throw failure('SESSION_CHANGED');
      requireLogin(data);
      if (data.error) throw failure('YOUTUBE_REJECTED');
      await keepSession();
      var items = Core.parseHistory(data);
      YTV.store.set('syncRemote', { items: items, at: Date.now() });
      pullAt = Date.now();
      status = 'Connected · ' + items.length + ' recent YouTube entries';
      if (YTV.ui) items.forEach(function (v) { YTV.ui.refreshProgress(v.id); });
      return items;
    })().catch(function (e) { status = 'Could not refresh YouTube history (' + (e.syncCode || 'HISTORY_PROCESSING') + ').'; throw new Error(status); })
      .finally(function () { pulling = null; });
    return pulling;
  }
  async function tracking(job) {
    var previous = metadata[job.cpn];
    if (previous && Date.now() - previous.at < 5 * 60000) return previous.urls;
    var data = await api('player', { videoId: job.id });
    var urls = Core.tracking(data, job.id);
    metadata[job.cpn] = { urls: urls, at: Date.now() };
    return urls;
  }
  async function sendStats(args) {
    var result = await native(args);
    var code = result.ret === true ? 200 : result.msg && result.msg.status;
    if (code !== 200 && code !== 204) throw new Error('Watched update not confirmed');
  }
  function groups(ranges) {
    var out = [];
    ranges.forEach(function (r) {
      var last = out[out.length - 1];
      if (last && Math.abs(last.end - r.start) < 0.1) { last.end = r.end; last.seq = r.seq; }
      else out.push({ start: r.start, end: r.end, seq: r.seq });
    });
    return out;
  }
  function flush(retry) {
    if (manual) return Promise.resolve();
    if (!enabled()) return Promise.resolve();
    if (retry) jobs.forEach(function (job) { job.uncertain = false; });
    if (flushing) return flushing;
    flushing = (async function () {
      await keepSession();
      for (var job of jobs.slice()) {
        if (!enabled()) break;
        if (job.uncertain || !job.ranges.length) continue;
        var snapshot = { ranges: job.ranges.slice(0, 120), pos: job.pos, final: job.final, endSeq: job.seq };
        var urls;
        try { urls = await tracking(job); }
        catch (_) { status = 'Could not prepare a watched update. Your progress is saved on this TV.'; continue; }
        if (!enabled() || job.connectionId !== connectionId) break;
        var segments = groups(snapshot.ranges);
        try {
          if (!job.playbackSent) {
            await sendStats(Core.statsArgs(session(), urls[0], job.id, job.cpn, segments[0], snapshot.pos, false, true));
            job.playbackSent = true;
            persist();
          }
          for (var i = 0; i < segments.length; i++) {
            if (!enabled() || job.connectionId !== connectionId) break;
            var segment = segments[i], last = i === segments.length - 1;
            await sendStats(Core.statsArgs(session(), urls[1], job.id, job.cpn, segment, last ? snapshot.pos : segment.end, last && snapshot.final && snapshot.endSeq === segment.seq, false));
            job.ranges = job.ranges.filter(function (r) { return r.seq > segment.seq; });
            persist();
          }
          if (job.closed && !job.ranges.length) { jobs = jobs.filter(function (j) { return j !== job; }); delete metadata[job.cpn]; persist(); }
          status = jobs.some(function (j) { return j.ranges.length > 0; }) ? 'Playback updates pending' : 'History sync up to date';
        } catch (_) {
          // A failed network response may still have reached YouTube. Keep it
          // for explicit user retry instead of replaying it automatically.
          job.uncertain = true;
          persist();
          status = 'A watched update was not confirmed. Use Retry pending updates in Account.';
        }
      }
    })().catch(function (e) { status = 'Sync unavailable (' + (e.syncCode || 'CONNECTION') + '). Your progress is saved on this TV.'; })
      .finally(function () { flushing = null; });
    return flushing;
  }
  function cpn() {
    var bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes).map(function (v) { return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[v & 63]; }).join('');
  }
  function exclusive(action) {
    if (manual) return Promise.reject(new Error('A history action is already running.'));
    manual = (async function () {
      // Reserve the writer before waiting for an existing automatic request.
      if (flushing) await flushing;
      if (pulling) await pulling;
      if (!enabled()) throw new Error('Enable history sync in Account first.');
      if (current || YTV.player && YTV.player.isOpen()) throw new Error('Close playback before editing history.');
      var id = connectionId;
      function check() {
        if (!enabled() || connectionId !== id) throw new Error('History sync paused or the connection changed.');
        if (current || YTV.player && YTV.player.isOpen()) throw new Error('Close playback before editing history.');
      }
      await keepSession(); check();
      return action(check);
    })().finally(function () { manual = null; });
    return manual;
  }
  function forgetQueued(id) {
    jobs = jobs.filter(function (j) { if (j.id !== id) return true; delete metadata[j.cpn]; return false; });
    persist();
  }
  function remembered(id, position, duration) {
    var r = (YTV.store.get('syncManualReports', {}) || {})[id];
    return r && r.connectionId === connectionId && Date.now() - r.at < 10 * 60000 && r.duration === duration && r.pos >= position;
  }
  async function report(video, complete, check) {
    if (!Core.validId(video.id) || video.live) throw new Error('This video cannot be marked watched.');
    check();
    var data = await api('player', { videoId: video.id }), urls = Core.tracking(data, video.id);
    var duration = Number(data.videoDetails.lengthSeconds);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('YouTube did not provide a video duration.');
    var position = complete || video.done ? duration : Math.min(duration, Number(video.pos) || 0);
    if (!Number.isFinite(position) || position <= 0) throw new Error('No playback progress saved for this video.');
    var token = cpn(), range = { start: 0, end: position };
    check();
    // Explicit user correction: report the requested position as watched.
    // Never automatically retry an ambiguous response.
    try {
      await sendStats(Core.statsArgs(session(), urls[0], video.id, token, range, position, false, true));
      check();
      await sendStats(Core.statsArgs(session(), urls[1], video.id, token, range, position, position / duration >= 0.95, false));
    } catch (_) {
      jobs.forEach(function (job) { if (job.id === video.id) job.uncertain = true; }); persist();
      throw new Error('Update not confirmed; some data may have reached YouTube. No automatic retry was made.');
    }
    check();
    forgetQueued(video.id);
    var receipts = YTV.store.get('syncManualReports', {});
    Object.keys(receipts).forEach(function (id) { if (Date.now() - receipts[id].at >= 10 * 60000) delete receipts[id]; });
    receipts[video.id] = { pos: position, duration: duration, at: Date.now(), connectionId: connectionId };
    YTV.store.set('syncManualReports', receipts);
    var saved = cache(), index = saved.items.findIndex(function (v) { return v.id === video.id; });
    var updated = Object.assign({}, video, { fromYouTube: true, fraction: position / duration, seconds: duration });
    if (index < 0) saved.items.unshift(updated); else saved.items[index] = updated;
    YTV.store.set('syncRemote', saved);
    return duration;
  }
  function catchUp() {
    // Snapshot the raw TV record, not the merged display of cloud progress.
    var videos = YTV.history.recorded().slice(0, 12);
    return exclusive(async function (check) {
      var cloud = await pull(true); check();
      var result = { updated: 0, skipped: 0, awaiting: 0, failed: 0, remaining: 0 };
      for (var i = 0; i < videos.length; i++) {
        var video = videos[i], duration = Number(video.seconds), position = video.done ? duration : Number(video.pos);
        if (video.live || !Core.validId(video.id) || !(duration > 0) || !(position > 0)) { result.skipped++; continue; }
        var remote = cloud.find(function (v) { return v.id === video.id; });
        var fraction = Math.min(1, position / duration);
        if (remote && typeof remote.fraction === 'number' && (remote.fraction >= fraction || remote.fraction >= 0.95 && video.done)) { result.skipped++; continue; }
        // Unknown cloud progress could already be ahead. Do not overwrite it.
        if (remote && remote.fraction === null) { result.skipped++; continue; }
        if (remembered(video.id, position, duration)) { result.awaiting++; continue; }
        try { await report(video, false, check); result.updated++; }
        catch (e) { result.failed++; result.remaining = videos.length - i - 1; result.error = e.message; break; }
      }
      status = result.updated + ' progress updates sent to YouTube';
      return result;
    });
  }
  function markComplete(video) {
    return exclusive(async function (check) {
      var duration = await report(video, true, check);
      YTV.history.complete(video, duration);
      if (YTV.ui) YTV.ui.refreshProgress(video.id);
      status = 'Marked watched on YouTube';
    });
  }
  function removeVideo(id) {
    return exclusive(async function (check) {
      if (!Core.validId(id)) throw new Error('Invalid video.');
      var data = await api('browse', { browseId: 'FEhistory' }, Core.REMOVE_FIELDS); check(); requireLogin(data);
      var command = Core.removal(data, id);
      if (!command) throw new Error('YouTube did not provide a remove control for this video. You can still remove it from Recent on this TV.');
      var response;
      try { response = await api('feedback', command); }
      catch (_) {
        jobs.forEach(function (job) { if (job.id === id) job.uncertain = true; }); persist();
        throw new Error('Removal not confirmed; it may have reached YouTube. Refresh history before trying again.');
      }
      check();
      if (!response.feedbackResponses || !response.feedbackResponses[0] || response.feedbackResponses[0].isProcessed !== true) {
        jobs.forEach(function (job) { if (job.id === id) job.uncertain = true; }); persist();
        throw new Error('YouTube did not confirm removal. Refresh history before trying again.');
      }
      forgetQueued(id);
      var saved = cache(); saved.items = saved.items.filter(function (v) { return v.id !== id; });
      YTV.store.set('syncRemote', saved);
      var receipts = YTV.store.get('syncManualReports', {}); delete receipts[id]; YTV.store.set('syncManualReports', receipts);
      YTV.history.remove(id);
      status = 'Removed from YouTube history';
    });
  }
  function qualify(job) {
    if (job.queued || job.realSeconds < 3 && !job.final) return;
    if (!job.ranges.length) return;
    if (jobs.length >= 40) { status = 'Sync queue is full. Review pending updates in Account.'; return; }
    job.queued = true; jobs.push(job);
  }
  function sample(pos, duration, speed) {
    var job = current;
    if (!enabled() || !job || !Number.isFinite(pos) || pos < 0) return;
    var now = Date.now(), before = job.last, elapsed = before ? (now - before.at) / 1000 : 0;
    job.last = { pos: pos, at: now };
    job.pos = Math.max(0, Math.min(pos, duration || pos));
    if (duration > 0) job.duration = duration;
    if (before) {
      var delta = pos - before.pos;
      if (elapsed > 0 && elapsed <= 12 && delta > 0 && delta <= elapsed * Math.max(0.25, speed || 1) + 2) {
        job.seq++;
        job.ranges.push({ start: before.pos, end: pos, seq: job.seq });
        job.realSeconds += Math.min(elapsed, delta / Math.max(0.25, speed || 1));
        if (job.ranges.length > 1200) { job.ranges.shift(); status = 'Some older offline watch intervals were dropped; current progress is kept.'; }
      }
    }
    qualify(job);
    if (job.queued) persist();
  }
  function end(pos, duration, speed, finished) {
    if (!current) return;
    sample(pos, duration, speed);
    current.closed = true;
    current.final = !!finished;
    qualify(current);
    if (current.queued) persist();
    current = null;
    flush(false);
  }
  YTV.sync = {
    catchUp: catchUp,
    markComplete: markComplete,
    removeVideo: removeVideo,
    busy: function () { return !!manual; },
    enabled: enabled,
    configured: function () { try { session(); return true; } catch (_) { return false; } },
    status: function () { return jobs.some(function (j) { return j.uncertain; }) ? 'An update was not confirmed. Review pending updates below.' : status; },
    pending: function () { return jobs.filter(function (j) { return j.ranges.length > 0; }).length; },
    uncertain: function () { return jobs.filter(function (j) { return j.uncertain; }).length; },
    remote: function () { return cache().items; },
    get: function (id) { return cache().items.filter(function (v) { return v.id === id; })[0] || null; },
    remoteAt: function () { return cache().at; },
    hasPending: function (id) { return current && current.id === id || jobs.some(function (j) { return j.id === id && j.ranges.length > 0; }); },
    pull: pull,
    enable: async function () { await pull(); YTV.store.set('syncEnabled', true); status = 'History sync enabled'; },
    disable: function () { YTV.store.set('syncEnabled', false); current = null; status = 'History sync paused'; },
    disconnect: function () {
      YTV.store.set('syncEnabled', false);
      ['syncSession', 'syncRemote', 'syncOutbox', 'syncManualReports'].forEach(YTV.store.del);
      jobs = []; current = null; metadata = {}; healthAt = 0; status = 'Not connected';
    },
    retry: function () { return flush(true); },
    begin: function (video, at) {
      if (!enabled() || !Core.validId(video.id)) return;
      // cpn correlates playback reports; it is not an authentication secret.
      var bytes = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      current = { id: video.id, connectionId: connectionId, cpn: Array.from(bytes).map(function (v) { return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[v & 63]; }).join(''),
        pos: at || 0, duration: video.seconds || 0, last: { pos: at || 0, at: Date.now() }, realSeconds: 0, ranges: [], seq: 0, playbackSent: false, final: false, closed: false, queued: false, uncertain: false };
    },
    sample: sample,
    seek: function () { if (current) current.last = null; },
    pause: function (pos, duration, speed) { sample(pos, duration, speed); if (current) current.last = null; flush(false); },
    end: end,
    start: function () {
      if (YTV.MOCK) return;
      if (YTV.sync.configured()) status = enabled() ? 'Connected' : 'Connected · sync paused';
      clearInterval(timer);
      function run() {
        if (!enabled()) return;
        if (Date.now() - pullAt > 5 * 60000 && !(YTV.player && YTV.player.isOpen())) pull().catch(function () {});
        flush(false);
      }
      timer = setInterval(run, 30000);
      run();
    }
  };
})();
