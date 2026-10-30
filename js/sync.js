// Uses the TV's existing HTTP service. Disabled until a separate session is
// connected and the user enables sync. Never changes YouTube browser cookies.
(function () {
  'use strict';
  var YTV = window.YTV, Core = window.YTVSyncCore;
  var jobs = YTV.store.get('syncOutbox', []), current = null, flushing = null, pulling = null;
  var metadata = {}, timer, pullAt = 0;
  var status = 'Not connected';
  function enabled() { return !YTV.MOCK && YTV.store.get('syncEnabled', false); }
  function session() { return Core.validateSession(YTV.store.get('syncSession', null)); }
  function persist() { YTV.store.set('syncOutbox', jobs.slice(-40)); }
  function cache() { return YTV.store.get('syncRemote', { items: [], at: 0 }); }
  function failure(code) { var error = new Error(code); error.syncCode = code; return error; }
  async function native(args) {
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 25000);
    try {
      var r = await fetch('http://localhost:9009/service/basic/fetcher', {
        method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api: 'fetchResponse', args: args })
      });
      if (!r.ok) throw failure('TV_HTTP_' + r.status);
      try { return await r.json(); } catch (_) { throw failure('TV_RESPONSE_FORMAT'); }
    } catch (e) {
      if (e.syncCode) throw e;
      throw failure(e.name === 'AbortError' ? 'TV_TIMEOUT' : 'TV_CONNECTION');
    } finally { clearTimeout(timeout); }
  }
  async function api(endpoint, body) {
    var args;
    try { args = await Core.apiArgs(session(), endpoint, body); } catch (_) { throw failure('SIGN_REQUEST'); }
    var response = await native(args);
    if (response.ret !== true) throw failure('YOUTUBE_' + (response.msg && typeof response.msg.status === 'number' ? response.msg.status : 'SERVICE'));
    try { return typeof response.msg === 'string' ? JSON.parse(response.msg) : response.msg; } catch (_) { throw failure('YOUTUBE_RESPONSE_FORMAT'); }
  }
  function pull() {
    if (pulling) return pulling;
    pulling = (async function () {
      status = 'Reading YouTube history…';
      var data = await api('browse', { browseId: 'FEhistory' });
      if (data.responseContext && data.responseContext.mainAppWebResponseContext && data.responseContext.mainAppWebResponseContext.loggedOut) {
        YTV.store.set('syncEnabled', false);
        current = null;
        throw failure('SESSION_SIGNED_OUT');
      }
      if (data.error) throw failure('YOUTUBE_REJECTED');
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
  function flush(manual) {
    if (!enabled()) return Promise.resolve();
    if (manual) jobs.forEach(function (job) { job.uncertain = false; });
    if (flushing) return flushing;
    flushing = (async function () {
      for (var job of jobs.slice()) {
        if (!enabled()) break;
        if (job.uncertain || !job.ranges.length) continue;
        var snapshot = { ranges: job.ranges.slice(0, 120), pos: job.pos, final: job.final, endSeq: job.seq };
        var urls;
        try { urls = await tracking(job); }
        catch (_) { status = 'Could not prepare a watched update. Your progress is saved on this TV.'; continue; }
        var segments = groups(snapshot.ranges);
        try {
          if (!job.playbackSent) {
            await sendStats(Core.statsArgs(session(), urls[0], job.id, job.cpn, segments[0], snapshot.pos, false, true));
            job.playbackSent = true;
            persist();
          }
          for (var i = 0; i < segments.length; i++) {
            if (!enabled()) break;
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
    })().catch(function () { status = 'Sync unavailable. Your progress is saved on this TV.'; })
      .finally(function () { flushing = null; });
    return flushing;
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
      ['syncSession', 'syncRemote', 'syncOutbox'].forEach(YTV.store.del);
      jobs = []; current = null; metadata = {}; status = 'Not connected';
    },
    retry: function () { return flush(true); },
    begin: function (video, at) {
      if (!enabled() || !Core.validId(video.id)) return;
      // cpn correlates playback reports; it is not an authentication secret.
      var bytes = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      current = { id: video.id, cpn: Array.from(bytes).map(function (v) { return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[v & 63]; }).join(''),
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
