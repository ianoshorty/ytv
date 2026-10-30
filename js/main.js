// Starts the app: the left-hand menu, remote keys and the first screen.
(function () {
  "use strict";

  if (window.YTV_STALE) return; // reloading with a fresh page (see util.js)

  var YTV = window.YTV;
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 8, ESC: 27, BACK_ALT: 461 };

  // Lay the 1280x720 design out to fill whatever page size the TV gives.
  function fit() { document.getElementById("app").style.transform = "scale(" + (innerWidth / 1280) + ")"; }
  fit();
  window.addEventListener("resize", fit);

  var rail = document.getElementById("rail");
  [["home", "Home"], ["recent", "Recent"], ["sent", "Sent to TV"], ["subs", "Subscriptions"], ["search", "Search"], ["controls", "Controls"], ["account", "Account"]].forEach(function (s) {
    var item = YTV.el("div", "rail-item f", s[1]);
    item.dataset.screen = s[0];
    item._select = function () { YTV.nav.go(s[0], {}, true); };
    rail.appendChild(item);
  });
  rail.appendChild(YTV.el("div", "rail-foot", "YTV " + YTV.VERSION + (YTV.MOCK ? " · sample data" : "")));

  var lastBack = 0;
  function back() {
    if (YTV.nav.back()) return;
    if (YTV.nav.top().name !== "home") { YTV.nav.go("home", {}, true); return; }
    if (Date.now() - lastBack < 2000) {
      window.close();
      if (typeof window.Hisense_Exit === "function") window.Hisense_Exit();
      return;
    }
    lastBack = Date.now();
    YTV.toast("Press Back again to exit");
  }

  window.addEventListener("keydown", function (e) {
    var code = e.keyCode;
    if (YTV.player.key(code)) { e.preventDefault(); return; }
    var screen = YTV.nav.top();
    if (screen && screen.el._key && screen.el._key(code)) { e.preventDefault(); return; }
    if (code === KEY.LEFT) YTV.focus.move("left");
    else if (code === KEY.RIGHT) YTV.focus.move("right");
    else if (code === KEY.UP) YTV.focus.move("up");
    else if (code === KEY.DOWN) YTV.focus.move("down");
    else if (code === KEY.OK) YTV.focus.select();
    else if (code === KEY.BACK || code === KEY.ESC || code === KEY.BACK_ALT) back();
    else return;
    e.preventDefault();
  });

  YTV.nav.go("home", {}, true);
  YTV.send.start();
})();
