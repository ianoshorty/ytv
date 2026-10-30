// Full-screen player using YouTube's official embedded player.
// Remote: OK play/pause · ←/→ seek 10 s · ↑/↓ speed · 0–9 jump to 0–90% ·
// Red info · Green captions · Yellow quality · Blue play what your phone
// just sent · Back close.
(function () {
  "use strict";

  var YTV = window.YTV;
  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  // The embedded player can't be told which quality to play; YouTube picks
  // it from the player's size in real pixels. So "quality" here sets the
  // size the player is laid out at (then scaled to the screen), and the HUD
  // shows what YouTube actually chose.
  var QUALITIES = [
    { h: 1080, label: "1080p" },
    { h: 1440, label: "1440p" },
    { h: 2160, label: "4K" },
    { h: 480, label: "480p" },
    { h: 720, label: "720p" }
  ];
  var KEY = { OK: 13, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 179, FF: 417, RW: 412, STOP: 413 };
  var BACK = [8, 27, 461];

  var layer, frame, hud, hudTitle, hudMeta, hudState, fill, center;
  var yt = null, ytReady = null;
  var list = [], index = 0, open = false;
  var hudTimer, tick;
  var playGeneration = 0;
  var speed = YTV.store.get("speed", 1);
  var quality = YTV.store.get("quality", 1080);
  var captions = YTV.store.get("captions", false);

  function build() {
    layer = document.getElementById("player-layer");
    frame = document.getElementById("player-frame");
    hud = document.getElementById("hud");
    hudTitle = document.getElementById("hud-title");
    hudMeta = document.getElementById("hud-meta");
    hudState = document.getElementById("hud-state");
    fill = document.getElementById("hud-fill");
    layer.tabIndex = -1; // a focus target for remote keys, outside YouTube
    // Made here rather than in index.html, which the TV keeps cached.
    // A clear layer over YouTube's player: the TV remote's hidden pointer
    // rests mid-screen, and over the player it keeps YouTube's own pause
    // button showing.
    layer.insertBefore(YTV.el("div", "player-shield"), hud);
    // YTV's own symbol: ▶ while paused (stays), ❚❚ while playing (fades
    // with the controls).
    center = YTV.el("div", "player-center");
    layer.appendChild(center);
    sizeFrame();
  }

  function keepInputInApp(player) {
    var target = player || yt;
    if (!target || !target.getIframe) return;
    var embed = target.getIframe();
    if (!embed) return;
    // The transparent shield blocks hover, but doesn't prevent the iframe
    // receiving keyboard/programmatic focus. Both can expose YouTube's UI.
    embed.tabIndex = -1;
    if (open && document.activeElement === embed) {
      embed.blur();
      layer.focus({ preventScroll: true });
    }
  }

  function updateCenter() {
    if (!yt || !yt.getPlayerState) return;
    var paused = yt.getPlayerState() === YT.PlayerState.PAUSED;
    center.textContent = paused ? "▶" : "❚❚";
    center.classList.toggle("show", paused || hud.classList.contains("show"));
  }

  function sizeFrame() {
    var dpr = window.devicePixelRatio || 1;
    var w = quality * 16 / 9 / dpr, h = quality / dpr;
    frame.style.width = w + "px";
    frame.style.height = h + "px";
    frame.style.transform = "scale(" + (innerWidth / w) + ")";
  }

  function qualityLabel(h) {
    var q = QUALITIES.filter(function (x) { return x.h === h; })[0];
    return q ? q.label : h + "p";
  }

  function loadApi() {
    if (ytReady) return ytReady;
    ytReady = new Promise(function (resolve, reject) {
      window.onYouTubeIframeAPIReady = resolve;
      var tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.onerror = function () { ytReady = null; reject(new Error("Couldn't load YouTube's player")); };
      document.head.appendChild(tag);
    }).then(function () {
      return new Promise(function (resolve) {
        yt = new YT.Player("player", {
          width: "100%", height: "100%",
          playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1, cc_load_policy: captions ? 1 : 0 },
          events: {
            onReady: function (e) { keepInputInApp(e.target); resolve(); },
            onStateChange: onState,
            onApiChange: applyCaptions,
            onError: function (e) {
              var msg = e.data === 101 || e.data === 150 ? "This video can't be played outside YouTube." : "Player error " + e.data;
              YTV.toast(msg);
              if (open) {
                YTV.history.remove(video().id); // never played, so not "recent"
                close(true, true);
              }
            }
          }
        });
      });
    });
    return ytReady;
  }

  // YouTube turns captions on by itself for some videos and viewers; the
  // captions module is unloaded to switch them off.
  function applyCaptions() {
    if (!yt || !yt.loadModule) return;
    try {
      if (captions) yt.loadModule("captions"); else { yt.unloadModule("captions"); yt.unloadModule("cc"); }
    } catch (e) { /* no captions on this video */ }
  }

  function onState(e) {
    if (e.data === YT.PlayerState.PLAYING) {
      keepInputInApp();
      // Speed can't change during ads, so apply it whenever playback starts.
      if (yt.getPlaybackRate() !== speed) yt.setPlaybackRate(speed);
      applyCaptions();
    }
    if (e.data === YT.PlayerState.ENDED && open) {
      var d = yt.getDuration();
      YTV.history.progress(video().id, d, d);
      close(true);
    }
    if (e.data === YT.PlayerState.PAUSED && open) YTV.sync.pause(yt.getCurrentTime(), yt.getDuration(), yt.getPlaybackRate());
    showHud();
  }

  // Saves where you are every few seconds while playing.
  var lastSave = 0;
  function remember() {
    if (!yt || !yt.getCurrentTime || yt.getPlayerState() !== YT.PlayerState.PLAYING) return;
    if (Date.now() - lastSave < 5000) return;
    lastSave = Date.now();
    YTV.history.progress(video().id, yt.getCurrentTime(), yt.getDuration());
    YTV.sync.sample(yt.getCurrentTime(), yt.getDuration(), yt.getPlaybackRate());
  }

  function video() { return list[index]; }

  function updateHud() {
    if (!yt || !yt.getPlayerState) return;
    var state = { "-1": "Starting", 0: "Ended", 1: "Playing", 2: "Paused", 3: "Buffering", 5: "Ready" }[yt.getPlayerState()] || "";
    var dur = yt.getDuration() || 0, t = yt.getCurrentTime() || 0;
    hudState.textContent = state + " · " + yt.getPlaybackRate() + "x · quality " + qualityLabel(quality) +
      " asked, YouTube playing " + (yt.getPlaybackQuality() || "?") + " · captions " + (captions ? "on" : "off") +
      " · " + YTV.clock(t) + " / " + YTV.clock(dur);
    fill.style.width = dur ? (100 * t / dur) + "%" : "0";
  }

  function showHud(stay) {
    hud.classList.add("show");
    clearTimeout(hudTimer);
    if (!stay) hudTimer = setTimeout(hideHud, 3500);
    updateCenter();
  }

  function hideHud() {
    clearTimeout(hudTimer);
    hud.classList.remove("show");
    updateCenter();
  }

  function setSpeed(delta) {
    YTV.sync.sample(yt.getCurrentTime(), yt.getDuration(), yt.getPlaybackRate());
    var i = SPEEDS.indexOf(speed);
    speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + delta))];
    YTV.store.set("speed", speed);
    yt.setPlaybackRate(speed);
    YTV.toast("Speed " + speed + "x");
  }

  function nextQuality() {
    var i = QUALITIES.map(function (q) { return q.h; }).indexOf(quality);
    quality = QUALITIES[(i + 1) % QUALITIES.length].h;
    YTV.store.set("quality", quality);
    sizeFrame();
    YTV.toast("Quality: " + qualityLabel(quality) + " (YouTube may take a few seconds)");
  }

  function toggleCaptions() {
    captions = !captions;
    YTV.store.set("captions", captions);
    applyCaptions();
    YTV.toast("Captions " + (captions ? "on" : "off"));
  }

  function seek(s) {
    YTV.sync.seek();
    yt.seekTo(Math.max(0, yt.getCurrentTime() + s), true);
    YTV.toast((s > 0 ? "+" : "−") + Math.abs(s) + " s");
  }

  function togglePlay() {
    if (yt.getPlayerState() === YT.PlayerState.PLAYING) { yt.pauseVideo(); showHud(true); } else yt.playVideo();
  }

  // ended: the video finished, so its position was already saved.
  function close(ended, failed) {
    playGeneration++;
    open = false;
    clearInterval(tick);
    if (yt && yt.getCurrentTime) YTV.sync.end(yt.getCurrentTime(), yt.getDuration(), yt.getPlaybackRate(), ended === true && !failed);
    if (yt && yt.getCurrentTime && ended !== true && yt.getCurrentTime() > 0) {
      YTV.history.progress(video().id, yt.getCurrentTime(), yt.getDuration());
    }
    if (yt && yt.stopVideo) yt.stopVideo();
    layer.style.display = "none";
    document.body.classList.remove("playing");
    YTV.ui.refreshProgress(video().id);
  }

  YTV.player = {
    isOpen: function () { return open; },

    isPlaying: function (id) { return open && video().id === id; },

    play: function (videos, i) {
      if (open && yt && yt.getCurrentTime) {
        YTV.history.progress(video().id, yt.getCurrentTime(), yt.getDuration());
        YTV.sync.end(yt.getCurrentTime(), yt.getDuration(), yt.getPlaybackRate(), false);
        YTV.ui.refreshProgress(video().id);
      }
      if (!layer) build();
      list = videos;
      index = i;
      var v = video();
      var generation = ++playGeneration;
      hudTitle.textContent = v.title;
      hudMeta.textContent = [v.channel, v.published ? YTV.ago(v.published) : ""].filter(Boolean).join(" · ");
      layer.style.display = "block";
      document.body.classList.add("playing");
      open = true;
      showHud();
      var at = YTV.history.resumeAt(v.id, v.seconds);
      YTV.history.start(v);
      YTV.send.markPlayed(v.id);
      loadApi().then(function () {
        if (!open || generation !== playGeneration) return;
        YTV.sync.begin(v, at);
        yt.loadVideoById({ videoId: v.id, startSeconds: at });
        if (at) YTV.toast("Resuming at " + YTV.clock(at) + " · press 0 to start over");
        clearInterval(tick);
        lastSave = Date.now();
        tick = setInterval(function () { keepInputInApp(); updateHud(); remember(); }, 500);
      }, function (e) { YTV.toast(e.message); close(true, true); });
    },

    // Returns true if the key was handled.
    key: function (code) {
      if (!open) return false;
      // Red toggles the info bar, so it's handled before any key shows it.
      if (code === KEY.RED) {
        if (hud.classList.contains("show")) hideHud(); else showHud(true);
        return true;
      }
      showHud();
      if (BACK.indexOf(code) >= 0 || code === KEY.STOP) { close(); return true; }
      if (!yt || !yt.getPlayerState) return true;
      if (code === KEY.OK || code === KEY.PLAY_PAUSE) togglePlay();
      else if (code === KEY.PLAY) yt.playVideo();
      else if (code === KEY.PAUSE) { yt.pauseVideo(); showHud(true); }
      else if (code === KEY.LEFT) seek(-10);
      else if (code === KEY.RIGHT) seek(10);
      else if (code === KEY.RW) seek(-30);
      else if (code === KEY.FF) seek(30);
      else if (code === KEY.UP) setSpeed(1);
      else if (code === KEY.DOWN) setSpeed(-1);
      else if (code === KEY.GREEN) toggleCaptions();
      else if (code === KEY.YELLOW) nextQuality();
      else if (code === KEY.BLUE) { if (!YTV.send.playWaiting()) YTV.toast("Nothing waiting from your phone"); }
      else if (code >= 48 && code <= 57) {
        YTV.sync.seek();
        yt.seekTo((yt.getDuration() || 0) * (code - 48) / 10, true);
        YTV.toast((code - 48) * 10 + "%");
      }
      return true;
    }
  };
})();
