// YTV Phase 0: proves the platform before we build features.
// - the app installs and opens as a tile
// - storage survives restarts
// - remote keys reach the page (and which codes they send)
// - YouTube plays, speed control works, and whether Premium removes ads
// Plain ES2017 (no ?. or ??) for VIDAA's Chrome 111 engine.
(function () {
  "use strict";

  var VERSION = "0.1.1";
  var params = new URLSearchParams(location.search);
  // Key 2 cycles through these. The music videos usually carry ads, so if an
  // ad plays first, Premium isn't being applied. Some labels block embedding
  // on some sites; the player then says "unavailable".
  var VIDEOS = [
    { id: "LXb3EKWsInQ", label: "4K60 test (Costa Rica)" },
    { id: "dQw4w9WgXcQ", label: "Ad check: Rick Astley" },
    { id: "9bZkp7q19f0", label: "Ad check: Gangnam Style" }
  ];
  var videoIndex = 0;
  var VIDEO_ID = params.get("v") || VIDEOS[0].id;
  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  var checksEl = document.getElementById("checks");
  var keylistEl = document.getElementById("keylist");
  var hudEl = document.getElementById("hud");
  var toastEl = document.getElementById("toast");

  // --- storage ---------------------------------------------------------------
  function load(key, fallback) {
    try {
      var v = localStorage.getItem("ytv." + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem("ytv." + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  var launches = load("launches", 0) + 1;
  save("launches", launches);
  var seenKeys = load("keys", {});

  // --- checks panel ----------------------------------------------------------
  function check(label, value, good) {
    var row = document.createElement("div");
    row.className = "row";
    row.innerHTML = '<span class="k"></span><span class="v"></span>';
    row.firstChild.textContent = label;
    row.lastChild.textContent = String(value);
    if (good === true) row.lastChild.className += " ok";
    if (good === false) row.lastChild.className += " bad";
    checksEl.appendChild(row);
  }

  var hisenseApis = Object.getOwnPropertyNames(window).filter(function (n) { return /^(Hisense_|HiUtils_)/.test(n); });
  check("Version", VERSION);
  check("Launches remembered", launches, launches > 1 ? true : undefined);
  check("Running from", location.host + location.pathname);
  check("Page size", innerWidth + "x" + innerHeight + " @" + devicePixelRatio + "x");
  check("Hisense functions", hisenseApis.length, hisenseApis.length > 0);
  check("Engine", (navigator.userAgent.match(/Chrome\/[\d.]+/) || ["?"])[0]);
  if (typeof window.Hisense_GetFirmWareVersion === "function") {
    try { check("Firmware", window.Hisense_GetFirmWareVersion()); } catch (e) { /* not allowed here */ }
  }

  // --- remote keys -----------------------------------------------------------
  function renderKeys() {
    var names = Object.keys(seenKeys);
    keylistEl.innerHTML = "";
    if (!names.length) {
      keylistEl.textContent = "Press each remote button once (arrows, OK, Back, colours, numbers, play/pause…).";
      return;
    }
    names.forEach(function (code) {
      var row = document.createElement("div");
      row.className = "row";
      row.innerHTML = '<span class="k"></span><span class="v"></span>';
      row.firstChild.textContent = "keyCode " + code;
      row.lastChild.textContent = seenKeys[code];
      keylistEl.appendChild(row);
    });
  }
  renderKeys();

  var toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.display = "none"; }, 1500);
  }

  // --- player ----------------------------------------------------------------
  var player = null;
  var speedIndex = SPEEDS.indexOf(1);

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player("player", {
      width: "100%", height: "100%", videoId: VIDEO_ID,
      playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3 },
      events: {
        onReady: function () { player.playVideo(); },
        onError: function (e) { hudEl.textContent = "Player error " + e.data + " (101/150 = this video can't be embedded)"; }
      }
    });
    setInterval(updateHud, 1000);
  };
  var tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  tag.onerror = function () { hudEl.textContent = "Couldn't load the YouTube player."; };
  document.head.appendChild(tag);

  function fmt(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }

  function updateHud() {
    if (!player || !player.getPlayerState) return;
    var states = { "-1": "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };
    hudEl.textContent = (states[player.getPlayerState()] || "?") + " · " + player.getPlaybackRate() + "x · " +
      player.getPlaybackQuality() + " · " + fmt(player.getCurrentTime()) + " / " + fmt(player.getDuration());
  }

  function setSpeed(delta) {
    speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, speedIndex + delta));
    player.setPlaybackRate(SPEEDS[speedIndex]);
    toast("Speed " + SPEEDS[speedIndex] + "x");
  }

  function seek(seconds) {
    player.seekTo(Math.max(0, player.getCurrentTime() + seconds), true);
    toast((seconds > 0 ? "+" : "") + seconds + " s");
  }

  function togglePlay() {
    if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo();
  }

  function nextVideo() {
    videoIndex = (videoIndex + 1) % VIDEOS.length;
    speedIndex = SPEEDS.indexOf(1);
    player.loadVideoById(VIDEOS[videoIndex].id);
    toast(VIDEOS[videoIndex].label);
  }

  var lastBack = 0;
  function back() {
    if (document.body.className === "full") {
      document.body.className = "";
      return;
    }
    if (Date.now() - lastBack < 2000) {
      window.close();
      if (typeof window.Hisense_Exit === "function") window.Hisense_Exit();
      return;
    }
    lastBack = Date.now();
    toast("Press Back again to exit");
  }

  // Standard codes; VIDAA's own will show in the "Remote keys seen" list and
  // get added here once we know them.
  var KEYS = {
    13: togglePlay, 37: function () { seek(-10); }, 39: function () { seek(10); },
    38: function () { setSpeed(1); }, 40: function () { setSpeed(-1); },
    8: back, 27: back, 461: back,
    403: function () { document.body.className = document.body.className === "full" ? "" : "full"; },
    49: function () { document.body.className = document.body.className === "full" ? "" : "full"; },
    50: nextVideo
  };

  window.addEventListener("keydown", function (e) {
    seenKeys[e.keyCode] = (e.key || "?") + (e.code ? " / " + e.code : "");
    save("keys", seenKeys);
    renderKeys();
    var action = KEYS[e.keyCode];
    if (!action) return;
    e.preventDefault();
    var needsPlayer = action !== back;
    if (needsPlayer && !(player && player.getPlayerState)) return;
    action();
  });
})();
