// Send to TV: save a video to your YouTube playlist called "TV" (on your
// phone: Save → TV) and YTV plays it. YTV checks the playlist every 10 s
// while you're browsing and every 30 s while a video plays (1 unit each).
// With read-only access YTV can't remove videos from the playlist, so it
// remembers which ones it has played and ignores them.
(function () {
  "use strict";

  var YTV = window.YTV;
  var BROWSING_MS = 10000;
  var PLAYING_MS = 30000;
  var FRESH_MS = 3 * 60 * 1000; // sent this recently when YTV opens: play it

  var known = null; // playlist item ids seen since YTV opened
  var timer = null;
  var waiting = null; // a video sent while another was playing

  function played() { return YTV.store.get("tvPlayed", []); }

  YTV.send = {
    status: "not started",

    // Unplayed videos from the "TV" playlist, newest first (last check).
    pending: function () { return YTV.store.get("tvPending", []); },

    // Marks every queued copy of this video as played.
    markPlayed: function (videoId) {
      var queue = YTV.store.get("tvQueue", []);
      var ids = queue.filter(function (q) { return q.video.id === videoId; }).map(function (q) { return q.item; });
      if (!ids.length) return;
      YTV.store.set("tvPlayed", ids.concat(played()).slice(0, 300));
      YTV.store.set("tvPending", YTV.send.pending().filter(function (q) { return q.video.id !== videoId; }));
      if (waiting && waiting.video.id === videoId) waiting = null;
    },

    // Plays the video sent while something else was playing (Blue key).
    playWaiting: function () {
      if (!waiting) return false;
      var w = waiting;
      waiting = null;
      YTV.player.play([w.video], 0);
      return true;
    },

    check: function () {
      if (!YTV.auth.signedIn() || !(YTV.MOCK || YTV.config.apiKey)) { YTV.send.status = "sign in to use"; return Promise.resolve(); }
      return YTV.api.tvPlaylist().then(function (id) {
        if (!id) { YTV.send.status = "no playlist called TV yet"; return; }
        return YTV.api.playlistQueue(id).then(function (queue) {
          YTV.send.status = "watching your TV playlist";
          var done = played();
          var unplayed = queue.filter(function (q) { return done.indexOf(q.item) < 0; });
          YTV.store.set("tvQueue", queue);
          YTV.store.set("tvPending", unplayed);
          var first = known === null;
          var fresh = unplayed.filter(function (q) {
            return first ? Date.now() - new Date(q.addedAt).getTime() < FRESH_MS : known.indexOf(q.item) < 0;
          });
          known = queue.map(function (q) { return q.item; });
          if (fresh.length) arrived(fresh[0], unplayed.length);
          else if (first && unplayed.length) {
            // Home was drawn before this first check: redraw it with the row.
            var top = YTV.nav.top();
            if (top && top.name === "home" && !YTV.player.isOpen()) YTV.nav.go("home", {}, true);
            YTV.toast(unplayed.length + " sent from your phone · on Home");
          }
        });
      }, function (e) { YTV.send.status = "error: " + e.message; });
    },

    start: function () {
      clearTimeout(timer);
      function loop() {
        YTV.send.check().then(function () {
          timer = setTimeout(loop, YTV.player.isOpen() ? PLAYING_MS : BROWSING_MS);
        });
      }
      loop();
    }
  };

  // Plays the newest arrival now, or offers it if something's playing.
  function arrived(q, count) {
    var more = count > 1 ? " (" + (count - 1) + " more on Home)" : "";
    if (!YTV.player.isOpen()) {
      YTV.player.play([q.video], 0);
      YTV.toast("From your phone: " + q.video.title + more);
    } else if (!YTV.player.isPlaying(q.video.id)) {
      waiting = q;
      YTV.toast("From your phone: " + q.video.title + " · press Blue to play it" + more);
    }
  }
})();
