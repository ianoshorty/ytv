// Full-screen player using YouTube's official embedded player.
// Remote: OK play/pause · ←/→ seek 10 s · ↑/↓ speed · 0–9 jump to 0–90% ·
// Red info · Back close.
(function () {
  "use strict";

  var YTV = window.YTV;
  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  // YouTube picks quality from the player's size in real pixels, so the
  // player is laid out at 1920x1080 real pixels and scaled to the screen.
  var TARGET = [1920, 1080];

  var layer, frame, hud, hudTitle, hudMeta, hudState, fill;
  var yt = null, ytReady = null;
  var list = [], index = 0, open = false;
  var hudTimer, tick;
  var speed = YTV.store.get("speed", 1);

  function build() {
    layer = document.getElementById("player-layer");
    frame = document.getElementById("player-frame");
    var dpr = window.devicePixelRatio || 1;
    var w = TARGET[0] / dpr, h = TARGET[1] / dpr;
    frame.style.width = w + "px";
    frame.style.height = h + "px";
    frame.style.transform = "scale(" + (innerWidth / w) + ")";
    hud = document.getElementById("hud");
    hudTitle = document.getElementById("hud-title");
    hudMeta = document.getElementById("hud-meta");
    hudState = document.getElementById("hud-state");
    fill = document.getElementById("hud-fill");
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
          playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1 },
          events: {
            onReady: function () { resolve(); },
            onStateChange: onState,
            onError: function (e) {
              var msg = e.data === 101 || e.data === 150 ? "This video can't be played outside YouTube." : "Player error " + e.data;
              YTV.toast(msg);
              if (open) close();
            }
          }
        });
      });
    });
    return ytReady;
  }

  function onState(e) {
    // Speed can't change during ads, so apply it whenever playback starts.
    if (e.data === YT.PlayerState.PLAYING && yt.getPlaybackRate() !== speed) yt.setPlaybackRate(speed);
    if (e.data === YT.PlayerState.ENDED && open) close();
    showHud();
  }

  function video() { return list[index]; }

  function updateHud() {
    if (!yt || !yt.getPlayerState) return;
    var state = { "-1": "Starting", 0: "Ended", 1: "Playing", 2: "Paused", 3: "Buffering", 5: "Ready" }[yt.getPlayerState()] || "";
    var dur = yt.getDuration() || 0, t = yt.getCurrentTime() || 0;
    hudState.textContent = state + " · " + yt.getPlaybackRate() + "x · " + (yt.getPlaybackQuality() || "") +
      " · " + YTV.clock(t) + " / " + YTV.clock(dur);
    fill.style.width = dur ? (100 * t / dur) + "%" : "0";
  }

  function showHud(stay) {
    hud.classList.add("show");
    clearTimeout(hudTimer);
    if (!stay) hudTimer = setTimeout(function () { hud.classList.remove("show"); }, 3500);
  }

  function setSpeed(delta) {
    var i = SPEEDS.indexOf(speed);
    speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + delta))];
    YTV.store.set("speed", speed);
    yt.setPlaybackRate(speed);
    YTV.toast("Speed " + speed + "x");
  }

  function seek(s) {
    yt.seekTo(Math.max(0, yt.getCurrentTime() + s), true);
    YTV.toast((s > 0 ? "+" : "−") + Math.abs(s) + " s");
  }

  function close() {
    open = false;
    clearInterval(tick);
    if (yt && yt.stopVideo) yt.stopVideo();
    layer.style.display = "none";
    document.body.classList.remove("playing");
  }

  YTV.player = {
    isOpen: function () { return open; },

    play: function (videos, i) {
      if (!layer) build();
      list = videos;
      index = i;
      var v = video();
      hudTitle.textContent = v.title;
      hudMeta.textContent = [v.channel, v.published ? YTV.ago(v.published) : ""].filter(Boolean).join(" · ");
      layer.style.display = "block";
      document.body.classList.add("playing");
      open = true;
      showHud();
      loadApi().then(function () {
        if (!open) return;
        yt.loadVideoById(v.id);
        clearInterval(tick);
        tick = setInterval(updateHud, 500);
      }, function (e) { YTV.toast(e.message); close(); });
    },

    // Returns true if the key was handled.
    key: function (code) {
      if (!open) return false;
      showHud();
      if (code === 8 || code === 27 || code === 461) { close(); return true; }
      if (!yt || !yt.getPlayerState) return true;
      if (code === 13) {
        if (yt.getPlayerState() === YT.PlayerState.PLAYING) { yt.pauseVideo(); showHud(true); } else yt.playVideo();
      } else if (code === 37) seek(-10);
      else if (code === 39) seek(10);
      else if (code === 38) setSpeed(1);
      else if (code === 40) setSpeed(-1);
      else if (code >= 48 && code <= 57) {
        yt.seekTo((yt.getDuration() || 0) * (code - 48) / 10, true);
        YTV.toast((code - 48) * 10 + "%");
      } else if (code === 403) {
        if (hud.classList.contains("show")) hud.classList.remove("show"); else showHud(true);
      }
      return true;
    }
  };
})();
