// Loads the app. index.html stays cached on the TV until a full restart, but
// this file is fetched fresh on every launch, so the list of scripts lives
// here and new files reach the TV without a restart.
(function () {
  "use strict";

  var t = window.YTV_BOOT_T || Date.now();
  var css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "app.css?t=" + t;
  document.head.appendChild(css);
  ["util", "api", "auth", "mock", "history", "send", "clusters", "nav", "player", "screens", "main"].forEach(function (name) {
    var js = document.createElement("script");
    js.src = "js/" + name + ".js?t=" + t;
    js.async = false; // keep them in order
    document.body.appendChild(js);
  });
})();
