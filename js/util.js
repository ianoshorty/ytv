// Shared helpers. Plain browser JavaScript, no build step; runs on the TV's
// Chrome 111 engine.
(function () {
  "use strict";

  var YTV = window.YTV = {};
  YTV.VERSION = "0.2.0";

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
  // address bar.
  (function loadConfig() {
    var m = /[#&]cfg=([A-Za-z0-9_\-]+)/.exec(location.hash);
    if (m) {
      try {
        var json = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
        YTV.store.set("cfg", JSON.parse(json));
      } catch (e) { /* malformed: ignore */ }
      history.replaceState(null, "", location.pathname + location.search);
    }
  })();
  YTV.config = YTV.store.get("cfg", {});
  YTV.MOCK = /[?&]mock=1/.test(location.search);
})();
