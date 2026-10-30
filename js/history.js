// What you've played in YTV on this TV, with where you stopped. Stored on
// the TV only. YouTube's own watch history can't be read or written by
// third-party apps.
(function () {
  "use strict";

  var YTV = window.YTV;
  var MAX = 60;
  var MIN_RESUME = 15; // seconds; earlier than this just starts again
  var DONE = 0.95; // watched this fraction or more counts as finished

  function all() { return YTV.store.get("history", []); }
  function save(list) { YTV.store.set("history", list.slice(0, MAX)); }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  YTV.history = {
    all: all,

    get: function (id) { return find(all(), id); },

    // Moves the video to the top of the list when it starts playing.
    start: function (v) {
      var list = all();
      var prev = find(list, v.id);
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
      var list = all();
      var h = find(list, id);
      if (!h) return;
      if (duration) h.seconds = Math.round(duration);
      h.pos = Math.round(pos);
      h.done = !!(h.seconds && pos / h.seconds >= DONE);
      h.at = Date.now();
      save(list);
    },

    // Where to start, or 0 to start from the beginning.
    resumeAt: function (id) {
      var h = find(all(), id);
      if (!h || h.done || h.live || !h.pos || h.pos < MIN_RESUME) return 0;
      return Math.max(0, h.pos - 3);
    },

    // 0–1 for the bar under a thumbnail, or null if never played.
    fraction: function (id) {
      var h = find(all(), id);
      if (!h) return null;
      if (h.done) return 1;
      return h.seconds ? Math.min(1, h.pos / h.seconds) : 0;
    },

    // Watched to the end (95% or more).
    watched: function (id) {
      var h = find(all(), id);
      return !!(h && h.done);
    },

    // Not finished and started: what "Continue watching" shows.
    unfinished: function () {
      return all().filter(function (h) { return !h.done && !h.live && h.pos >= MIN_RESUME; });
    },

    remove: function (id) { save(all().filter(function (h) { return h.id !== id; })); },

    clear: function () { YTV.store.del("history"); }
  };
})();
