// Shared helpers. Plain browser JavaScript, no build step; runs on the TV's
// Chrome 111 engine.
(function () {
  "use strict";

  var YTV = window.YTV = {};
  YTV.VERSION = "0.4.0";

  YTV.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };

  // --- storage (per TV, survives restarts) ---------------------------------
  YTV.store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem("ytv." + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set: function (key, value) {
      try { localStorage.setItem("ytv." + key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
    },
    del: function (key) {
      try { localStorage.removeItem("ytv." + key); } catch (e) { /* ignore */ }
    }
  };

  // --- formatting -----------------------------------------------------------
  // YouTube's search results come HTML-escaped ("Rock &amp; Roll").
  var decoder = document.createElement("textarea");
  YTV.decode = function (s) {
    decoder.innerHTML = s || "";
    return decoder.value;
  };

  // "PT1H2M3S" -> seconds
  YTV.isoSeconds = function (iso) {
    var m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
    if (!m) return 0;
    return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  };

  YTV.clock = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var mm = h ? ("0" + m).slice(-2) : String(m);
    return (h ? h + ":" : "") + mm + ":" + ("0" + s).slice(-2);
  };

  YTV.ago = function (date) {
    var s = (Date.now() - new Date(date).getTime()) / 1000;
    var units = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
    for (var i = 0; i < units.length; i++) {
      var n = Math.floor(s / units[i][0]);
      if (n >= 1) return n + " " + units[i][1] + (n > 1 ? "s" : "") + " ago";
    }
    return "just now";
  };

  // --- toast ----------------------------------------------------------------
  var toastTimer;
  YTV.toast = function (text) {
    var t = document.getElementById("toast");
    t.textContent = text;
    t.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = "none"; }, 1800);
  };

  // --- config ---------------------------------------------------------------
  // The API key and sign-in client details never go in this public repo. The
  // installer adds them to the TV's app entry after "#cfg=", which browsers
  // never send to any server. They're saved on the TV and removed from the
  // address bar. If the TV's launcher drops the "#" part, the app reads its
  // own entry from the TV's app list instead (read-only).
  YTV.launch = { hashChars: location.hash.length };

  function parseCfg(text) {
    var m = /cfg=([A-Za-z0-9_\-]+)/.exec(text || "");
    if (!m) return null;
    try {
      return JSON.parse(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch (e) {
      return null;
    }
  }

  function fromAppList() {
    if (typeof window.HiUtils_createRequest !== "function") {
      YTV.launch.appList = "not available here";
      return null;
    }
    try {
      var res = window.HiUtils_createRequest("fileRead", { path: "websdk/Appinfo.json", mode: 6 });
      if (!res || !res.ret) { YTV.launch.appList = "couldn't read"; return null; }
      var apps = JSON.parse(res.msg).AppInfo || [];
      var mine = apps.filter(function (a) { return a.Id === "ytv_app"; })[0];
      if (!mine) { YTV.launch.appList = "no YTV entry"; return null; }
      var cfg = parseCfg(decodeURIComponent(mine.StartCommand || mine.URL || ""));
      YTV.launch.appList = cfg ? "keys found in YTV's entry" : "YTV's entry has no keys";
      return cfg;
    } catch (e) {
      YTV.launch.appList = "error: " + e.message;
      return null;
    }
  }

  (function loadConfig() {
    var cfg = parseCfg(location.hash);
    YTV.launch.source = cfg ? "address" : "";
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    if (!cfg && !YTV.store.get("cfg", null)) {
      cfg = fromAppList();
      if (cfg) YTV.launch.source = "app list";
    }
    if (cfg) YTV.store.set("cfg", cfg);
  })();
  YTV.config = YTV.store.get("cfg", {});
  if (!YTV.launch.source && YTV.config.apiKey) YTV.launch.source = "saved on TV";
  YTV.MOCK = /[?&]mock=1/.test(location.search);
})();
