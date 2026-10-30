// Local playback progress, combined with the optional YouTube sync cache.
// Merely appearing in YouTube history never implies completion.
(function () {
  "use strict";

  var YTV = window.YTV;
  var MAX = 60;
  var MIN_RESUME = 15; // seconds; earlier than this just starts again
  var DONE = 0.95; // watched this fraction or more counts as finished

  function local() { return YTV.store.get("history", []); }
  function remote(id) { return YTV.sync && YTV.sync.configured() ? YTV.sync.get(id) : null; }
  function effective(h, r) {
    if (!r) return h;
    if (h && (YTV.sync.hasPending(h.id) || h.at > YTV.sync.remoteAt() || r.fraction === null)) return h;
    var duration = r.seconds || h && h.seconds;
    return Object.assign({}, h || {}, r, { seconds: duration || null,
      pos: r.fraction !== null && duration ? Math.round(r.fraction * duration) : h && h.pos || 0,
      done: r.fraction !== null && r.fraction >= DONE, at: h && h.at || 0 });
  }
  function all() { return local().map(function (h) { return effective(h, remote(h.id)); }); }
  function combined() {
    var list = all(), ids = {};
    list.forEach(function (h) { ids[h.id] = true; });
    return list.concat(YTV.sync && YTV.sync.configured() ? YTV.sync.remote().filter(function (r) { return !ids[r.id]; }).map(function (r) { return effective(null, r); }) : []);
  }
  function save(list) { YTV.store.set("history", list.slice(0, MAX)); }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  YTV.history = {
    all: all,

    get: function (id) { return effective(find(local(), id), remote(id)); },

    // Moves the video to the top of the list when it starts playing.
    start: function (v) {
      var list = local();
      var prev = effective(find(list, v.id), remote(v.id));
      list = list.filter(function (h) { return h.id !== v.id; });
      list.unshift({
        id: v.id, title: v.title, channel: v.channel, channelId: v.channelId, thumb: v.thumb,
        published: v.published, live: v.live, seconds: v.seconds || (prev && prev.seconds) || null,
        pos: prev ? prev.pos : 0, done: prev ? prev.done : false, at: Date.now()
      });
      save(list);
    },

    // Records where playback is. duration comes from the player.
    progress: function (id, pos, duration) {
      var list = local();
      var h = find(list, id);
      if (!h) return;
      if (duration) h.seconds = Math.round(duration);
      h.pos = Math.round(pos);
      h.done = !!(h.seconds && pos / h.seconds >= DONE);
      h.at = Date.now();
      save(list);
    },

    // Where to start, or 0 to start from the beginning.
    resumeAt: function (id, duration) {
      var h = YTV.history.get(id);
      if (h && !h.pos && duration && h.fraction > 0 && h.fraction < DONE) h = Object.assign({}, h, { pos: Math.round(duration * h.fraction) });
      if (!h || h.done || h.live || !h.pos || h.pos < MIN_RESUME) return 0;
      return Math.max(0, h.pos - 3);
    },

    // 0–1 for the bar under a thumbnail, or null if never played.
    fraction: function (id) {
      var h = YTV.history.get(id);
      if (!h) return null;
      if (h.done) return 1;
      if (h.fromYouTube && typeof h.fraction === 'number') return h.fraction;
      if (h.fromYouTube && h.fraction === null && !h.pos) return null;
      return h.seconds ? Math.min(1, h.pos / h.seconds) : 0;
    },

    // Watched to the end (95% or more).
    watched: function (id) {
      var h = YTV.history.get(id);
      return !!(h && h.done);
    },

    // Not finished and started: what "Continue watching" shows.
    unfinished: function () {
      return combined().filter(function (h) { return !h.done && !h.live && h.pos >= MIN_RESUME; }).slice(0, MAX);
    },

    seen: function (id) { return !!remote(id); },
    remove: function (id) { save(local().filter(function (h) { return h.id !== id; })); },

    clear: function () { YTV.store.del("history"); }
  };
})();
